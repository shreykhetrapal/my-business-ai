import { answerQuestion, renderCallScript } from "./assistant.js";
import { ensureFollowUp, shouldCreateFollowUpFromAssistantText } from "./followUps.js";
import { nowIso } from "./store.js";
import { appendTranscriptEntry } from "./transcripts.js";
import { connectWebSocket } from "./websocket.js";

const DEFAULT_SILENCE_TIMEOUT_MS = 20_000;

function scopedKnowledge(knowledgeBase, campaignId) {
  return knowledgeBase.filter((item) => item.scope === "global" || item.scope === campaignId);
}

function campaignLanguageLabel(campaign) {
  const labels = {
    english: "English",
    hindi: "Hindi",
    hinglish: "Hinglish / mixed Hindi and English",
    custom: "Custom language plan"
  };
  return labels[campaign.languageMode] || labels.english;
}

function buildLanguageInstructions(campaign) {
  const base = [
    `Campaign language mode: ${campaignLanguageLabel(campaign)}.`,
    campaign.languageMode === "hindi" ? "Prefer natural Hindi unless the approved script uses English words or names." : null,
    campaign.languageMode === "hinglish" ? "Use natural Hinglish when the approved script or language notes mix Hindi and English." : null,
    campaign.languageInstructions ? `Campaign language notes: ${campaign.languageInstructions}` : null,
    campaign.languageMode && campaign.languageMode !== "english"
      ? "If the script is written as an English draft without exact quoted wording, render it naturally in the selected language while preserving every approved fact."
      : null,
    "If the approved script includes bracketed language markers like [Hindi] or [English], treat them as delivery directions and do not read the bracketed labels aloud.",
    "Preserve names, addresses, dates, brands, and approved offer details exactly."
  ].filter(Boolean);
  return base.join(" ");
}

export function buildRealtimeInstructions({ business, campaign, contact, knowledgeBase }) {
  const script = renderCallScript({ business, campaign, contact });
  const callMode = campaign.callMode || "conversational";
  const approvedAnswers = scopedKnowledge(knowledgeBase, campaign.id)
    .map((item) => `- ${item.topic}: Q: ${item.question} A: ${item.answer}`)
    .join("\n");

  return [
    "You are a warm, concise phone agent calling on behalf of a small business.",
    "The first assistant response must be the approved invitation script. Do not start with a generic greeting like 'How can I help you today?'",
    buildLanguageInstructions(campaign),
    callMode === "message"
      ? "This campaign is one-way message delivery. Speak the approved script, do not ask for questions, and do not respond to customer speech."
      : callMode === "message_then_conversation"
        ? "This campaign starts as message delivery. Do not let customer speech interrupt the opening message. After the opening message is complete, invite quick questions and then answer from approved details."
        : "After the approved invitation script, pause for the customer's reply.",
    "Answer only using the campaign facts and approved knowledge base in this prompt.",
    "If you do not have an approved answer, say you can take a message for the business to follow up.",
    "If the customer asks to schedule, book, reserve, confirm an appointment, get a reminder, or receive a callback, collect the requested time or message if offered and say you will pass it to the business. Do not claim the appointment is booked unless the approved details explicitly allow you to book it.",
    "If the customer asks to stop calls, confirm the opt-out and say they will not receive future calls.",
    "If the customer indicates they are done, for example 'thank you', 'that's all', 'ok bye', 'no more questions', 'bas itna', 'theek hai bas', or 'shukriya', say one short goodbye and do not ask another question.",
    "Do not invent discounts, dates, locations, inventory, policies, or guarantees.",
    "Keep responses short enough for a phone call.",
    "",
    "Approved invitation script:",
    script,
    "",
    "Campaign facts:",
    `Business: ${business.name}`,
    `Campaign: ${campaign.name}`,
    `Location: ${campaign.location}`,
    `Offer: ${campaign.offer || "No offer approved."}`,
    `Objective: ${campaign.objective || "Invite the customer and answer approved questions."}`,
    "",
    "Approved knowledge base:",
    approvedAnswers || "- No extra approved answers have been provided."
  ].join("\n");
}

function openAiRealtimeUrl() {
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
  return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
}

function transcriptionLanguage(campaign) {
  if (process.env.OPENAI_TRANSCRIPTION_LANGUAGE) return process.env.OPENAI_TRANSCRIPTION_LANGUAGE;
  if (campaign.languageMode === "english") return "en";
  if (campaign.languageMode === "hindi") return "hi";
  return "";
}

function buildInputTranscription(campaign, contact) {
  const config = {
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    prompt: [
      `This is a phone call for ${campaign.name}.`,
      `The customer is ${contact.name || "the customer"}.`,
      campaign.languageMode ? `Expected language mode: ${campaignLanguageLabel(campaign)}.` : null,
      campaign.languageInstructions ? `Language notes: ${campaign.languageInstructions}` : null,
      "Preserve names, places, menu items, and code-mixed Hindi/English words."
    ]
      .filter(Boolean)
      .join(" ")
  };
  const language = transcriptionLanguage(campaign);
  if (language) config.language = language;
  return config;
}

export function buildOpeningResponseInstructions({ business, campaign, contact }) {
  const openingScript = renderCallScript({ business, campaign, contact });
  const callMode = campaign.callMode || "conversational";
  const postScriptInstruction =
    callMode === "message"
      ? "After the script is complete, stop speaking. Do not ask for questions."
      : callMode === "message_then_conversation"
        ? "After the script is complete, add exactly: I can answer quick questions now. Then pause for the customer to reply."
        : "After the script is complete, pause for the customer to reply.";
  const deliveryInstruction = campaign.scriptNotes
    ? `Delivery/style notes from the campaign: ${campaign.scriptNotes}`
    : "Use a natural, professional phone delivery while preserving the wording.";
  const languageInstruction = buildLanguageInstructions(campaign);

  return [
    "This is the opening of an outbound phone call.",
    "Speak the following approved script as your first words.",
    "Do not add 'Hello', 'How can I help you', or any other generic assistant greeting before it.",
    "Preserve the approved wording, but do not read bracketed language markers aloud.",
    languageInstruction,
    deliveryInstruction,
    postScriptInstruction,
    "",
    openingScript
  ].join("\n");
}

function sendTwilioMedia(twilioSocket, streamSid, audio) {
  if (!streamSid) return;
  twilioSocket.sendJson({
    event: "media",
    streamSid,
    media: { payload: audio }
  });
}

function sendTwilioMark(twilioSocket, streamSid, name) {
  if (!streamSid) return;
  twilioSocket.sendJson({
    event: "mark",
    streamSid,
    mark: { name }
  });
}

export function shouldIgnoreCustomerAudio({ callMode, greetingFinished, lastAudioMarkSent, lastAudioMarkReceived }) {
  if (callMode === "message") return true;
  if (callMode !== "message_then_conversation") return false;
  if (!greetingFinished) return true;
  return Boolean(lastAudioMarkSent && lastAudioMarkReceived !== lastAudioMarkSent);
}

export function getRealtimeSilenceTimeoutMs(env = process.env) {
  const value = Number.parseInt(env.REALTIME_SILENCE_TIMEOUT_MS || "", 10);
  if (Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_SILENCE_TIMEOUT_MS;
}

function normalizeIntentText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCustomerEndIntent(text) {
  const lower = normalizeIntentText(text);
  if (!lower) return false;

  const continuationPatterns = [
    /\banother question\b/,
    /\bone more\b/,
    /\bmore question\b/,
    /\bi have (a )?(question|doubt)\b/,
    /\bbut\b/,
    /\balso\b/,
    /\bwhat\b/,
    /\bwhen\b/,
    /\bwhere\b/,
    /\bhow\b/,
    /\bcan you\b/,
    /\bcould you\b/
  ];
  if (continuationPatterns.some((pattern) => pattern.test(lower))) return false;

  const exactEndings = new Set([
    "thank you",
    "thanks",
    "thanks a lot",
    "thank you bye",
    "ok thank you",
    "okay thank you",
    "that s all",
    "that is all",
    "ok that s all",
    "okay that s all",
    "ok bye",
    "okay bye",
    "bye",
    "goodbye",
    "no more questions",
    "nothing else",
    "all good",
    "i m good",
    "i am good",
    "bas",
    "bas itna",
    "theek hai bas",
    "thik hai bas",
    "achha bye",
    "accha bye",
    "shukriya",
    "dhanyavaad",
    "dhanyawad",
    "nahi bas",
    "aur kuch nahi",
    "kuch nahi"
  ]);
  if (exactEndings.has(lower)) return true;

  const endingPatterns = [
    /\b(thank you|thanks|ok|okay).*\b(bye|goodbye)\b/,
    /\b(ok|okay|thank you|thanks).*\b(that s all|that is all|nothing else|no more questions|all good)\b/,
    /\b(that s all|that is all|nothing else|no more questions|all good)\b/,
    /\b(bas itna|theek hai bas|thik hai bas|aur kuch nahi|nahi bas|kuch nahi)\b/
  ];
  return endingPatterns.some((pattern) => pattern.test(lower));
}

export function isAssistantClosingIntent(text) {
  const lower = normalizeIntentText(text);
  if (!lower) return false;
  return [
    /\b(goodbye|bye bye|have a great day|have a good day)\b/,
    /\b(thanks|thank you).*\b(for your time|for calling|goodbye|bye)\b/,
    /\bwe hope to see you soon\b/,
    /\byou will not receive future calls\b/,
    /\byou won t receive future calls\b/
  ].some((pattern) => pattern.test(lower));
}

function closingInstructions(campaign) {
  const languageNote = campaign.languageMode && campaign.languageMode !== "english"
    ? `Use the campaign language mode (${campaignLanguageLabel(campaign)}) naturally.`
    : "Use English unless the customer used another campaign-approved language.";
  return [
    "The customer is done with the call.",
    languageNote,
    "Say one short, warm goodbye.",
    "Do not ask another question.",
    "Do not add any new campaign details."
  ].join(" ");
}

export async function handleRealtimeMediaStream(
  twilioSocket,
  { callLogId, store, findCampaign, findContact, getOpenAiApiKey, getBusiness, getKnowledgeBase } = {}
) {
  const callLog = store.state.callLogs.find((log) => log.id === callLogId);
  if (!callLog) {
    twilioSocket.close();
    return;
  }

  const campaign = findCampaign(callLog.campaignId);
  const contact = findContact(callLog.contactId);
  const callMode = campaign?.callMode || "conversational";
  const workspaceId = callLog.workspaceId || campaign?.workspaceId || contact?.workspaceId || "";
  const business = getBusiness ? getBusiness(workspaceId) : store.state.business;
  const knowledgeBase = getKnowledgeBase ? getKnowledgeBase(workspaceId) : store.state.knowledgeBase;
  if (!campaign || !contact) {
    callLog.status = "failed";
    callLog.error = "Missing campaign or contact for realtime call.";
    callLog.updatedAt = nowIso();
    store.save();
    twilioSocket.close();
    return;
  }

  const openAiApiKey = getOpenAiApiKey ? getOpenAiApiKey(workspaceId) : process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    callLog.status = "failed";
    callLog.error = "An OpenAI API key is required for this workspace before Realtime calls can run.";
    callLog.updatedAt = nowIso();
    store.save();
    twilioSocket.close();
    return;
  }

  callLog.status = "in_progress";
  callLog.realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
  callLog.rawTranscript ||= [];
  callLog.updatedAt = nowIso();
  store.save();

  let streamSid = null;
  let openAiSocket = null;
  let markCounter = 0;
  let openAiReady = false;
  let sessionUpdated = false;
  let greetingStarted = false;
  let greetingFinished = false;
  let activeResponse = false;
  let twilioMediaChunksSent = 0;
  let lastAudioMarkSent = null;
  let lastAudioMarkReceived = null;
  let closeAfterPlayback = false;
  let silenceTimer = null;
  const silenceTimeoutMs = getRealtimeSilenceTimeoutMs();
  const pendingInputTranscriptDeltas = new Map();
  const pendingTwilioAudio = [];

  function recordRealtimeEvent(type) {
    callLog.realtimeEventCounts ||= {};
    callLog.realtimeEventCounts[type] = (callLog.realtimeEventCounts[type] || 0) + 1;
  }

  function clearSilenceTimer() {
    if (!silenceTimer) return;
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function closeBoth() {
    clearSilenceTimer();
    if (openAiSocket) openAiSocket.close();
    twilioSocket.close();
  }

  function greetingPlaybackComplete() {
    return greetingFinished && (!lastAudioMarkSent || lastAudioMarkReceived === lastAudioMarkSent);
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    if (silenceTimeoutMs === 0 || callMode === "message" || activeResponse || !greetingPlaybackComplete()) return;
    callLog.silenceTimerStartedAt = nowIso();
    callLog.silenceTimeoutMs = silenceTimeoutMs;
    callLog.updatedAt = nowIso();
    store.save();
    silenceTimer = setTimeout(() => {
      callLog.silenceTimedOutAt = nowIso();
      callLog.endReason = "silence_timeout";
      callLog.updatedAt = nowIso();
      store.save();
      closeBoth();
    }, silenceTimeoutMs);
  }

  function flushPendingTwilioAudio() {
    if (!openAiReady || !openAiSocket) return;
    while (pendingTwilioAudio.length > 0) {
      openAiSocket.sendJson({
        type: "input_audio_buffer.append",
        audio: pendingTwilioAudio.shift()
      });
    }
  }

  function maybeStartGreeting() {
    if (!openAiSocket || !streamSid || !sessionUpdated || greetingStarted) return;
    greetingStarted = true;
    activeResponse = true;
    callLog.greetingStartedAt = nowIso();
    callLog.updatedAt = nowIso();
    store.save();
    openAiSocket.sendJson({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: buildOpeningResponseInstructions({
          business,
          campaign,
          contact
        })
      }
    });
  }

  function requestGoodbye(reason) {
    if (!openAiSocket || closeAfterPlayback) return;
    closeAfterPlayback = true;
    callLog.endIntentDetectedAt = callLog.endIntentDetectedAt || nowIso();
    callLog.endReason = reason;
    callLog.updatedAt = nowIso();
    store.save();
    clearSilenceTimer();
    if (!activeResponse) {
      activeResponse = true;
      openAiSocket.sendJson({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions: closingInstructions(campaign)
        }
      });
    }
  }

  twilioSocket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.event === "start") {
      streamSid = message.start?.streamSid || message.streamSid;
      callLog.twilioStreamSid = streamSid;
      callLog.twilioStreamStartedAt = nowIso();
      callLog.updatedAt = nowIso();
      store.save();
      flushPendingTwilioAudio();
      maybeStartGreeting();
      return;
    }

    if (message.event === "media" && message.media?.payload) {
      if (shouldIgnoreCustomerAudio({ callMode, greetingFinished, lastAudioMarkSent, lastAudioMarkReceived })) {
        return;
      }
      clearSilenceTimer();
      if (openAiReady && openAiSocket) {
        openAiSocket.sendJson({
          type: "input_audio_buffer.append",
          audio: message.media.payload
        });
      } else if (pendingTwilioAudio.length < 250) {
        pendingTwilioAudio.push(message.media.payload);
      }
      return;
    }

    if (message.event === "mark") {
      lastAudioMarkReceived = message.mark?.name;
      callLog.lastAudioMarkReceived = lastAudioMarkReceived;
      if (callMode !== "message" && greetingFinished && lastAudioMarkReceived === lastAudioMarkSent && !closeAfterPlayback) {
        if (!callLog.greetingPlaybackFinishedAt) {
          callLog.greetingPlaybackFinishedAt = nowIso();
        }
        armSilenceTimer();
      }
      callLog.updatedAt = nowIso();
      store.save();
      if (closeAfterPlayback && lastAudioMarkReceived === lastAudioMarkSent) {
        setTimeout(() => closeBoth(), 1500);
      }
      return;
    }

    if (message.event === "stop") {
      clearSilenceTimer();
      callLog.status = "completed";
      callLog.twilioMediaChunksSent = twilioMediaChunksSent;
      callLog.updatedAt = nowIso();
      store.save();
      closeBoth();
    }
  });

  try {
    openAiSocket = await connectWebSocket(openAiRealtimeUrl(), {
      headers: {
        Authorization: `Bearer ${openAiApiKey}`
      }
    });
    openAiReady = true;
    callLog.realtimeConnectedAt = nowIso();
    callLog.updatedAt = nowIso();
    store.save();

    const instructions = buildRealtimeInstructions({
      business,
      campaign,
      contact,
      knowledgeBase
    });

    const inputTranscription = buildInputTranscription(campaign, contact);
    callLog.inputTranscription = inputTranscription;
    callLog.inputTranscriptionEnabledAt = nowIso();
    callLog.updatedAt = nowIso();
    store.save();

    openAiSocket.sendJson({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions,
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: inputTranscription,
            turn_detection: { type: "server_vad" }
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: process.env.OPENAI_REALTIME_VOICE || "coral"
          }
        }
      }
    });
    flushPendingTwilioAudio();
  } catch (error) {
    callLog.status = "failed";
    callLog.error = error.message;
    callLog.updatedAt = nowIso();
    store.save();
    twilioSocket.close();
    return;
  }

  openAiSocket.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    recordRealtimeEvent(event.type);

    if (event.type === "session.updated") {
      sessionUpdated = true;
      callLog.inputTranscriptionAccepted = Boolean(event.session?.audio?.input?.transcription || event.session?.input_audio_transcription);
      callLog.realtimeSessionUpdatedAt = nowIso();
      callLog.updatedAt = nowIso();
      store.save();
      maybeStartGreeting();
      return;
    }

    if (event.type === "response.created") {
      activeResponse = true;
      clearSilenceTimer();
      return;
    }

    if (event.type === "response.done") {
      const completedGreeting = greetingStarted && !greetingFinished;
      activeResponse = false;
      if (completedGreeting) {
        greetingFinished = true;
        callLog.greetingFinishedAt = nowIso();
        if (callMode !== "message" && lastAudioMarkSent && lastAudioMarkReceived === lastAudioMarkSent && !closeAfterPlayback) {
          callLog.greetingPlaybackFinishedAt = callLog.greetingFinishedAt;
        }
        callLog.updatedAt = nowIso();
        store.save();
        if (callMode === "message") {
          closeAfterPlayback = true;
          if (!lastAudioMarkSent || lastAudioMarkReceived === lastAudioMarkSent) {
            setTimeout(() => closeBoth(), lastAudioMarkSent ? 1500 : 3000);
          }
        } else {
          armSilenceTimer();
        }
      } else {
        if (closeAfterPlayback) {
          if (!lastAudioMarkSent || lastAudioMarkReceived === lastAudioMarkSent) {
            setTimeout(() => closeBoth(), lastAudioMarkSent ? 1500 : 1000);
          }
        } else {
          armSilenceTimer();
        }
      }
      return;
    }

    if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
      const audio = event.delta || event.audio;
      sendTwilioMedia(twilioSocket, streamSid, audio);
      lastAudioMarkSent = `openai-audio-${markCounter += 1}`;
      sendTwilioMark(twilioSocket, streamSid, lastAudioMarkSent);
      if (streamSid && audio) {
        twilioMediaChunksSent += 1;
        callLog.lastAudioMarkSent = lastAudioMarkSent;
      }
      return;
    }

    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      if (event.transcript) {
        appendTranscriptEntry(callLog, {
          role: "assistant",
          text: event.transcript,
          at: nowIso(),
          source: "openai_realtime",
          eventType: event.type,
          itemId: event.item_id,
          contentIndex: event.content_index
        });
        if (shouldCreateFollowUpFromAssistantText(event.transcript)) {
          ensureFollowUp({
            store,
            callLog,
            campaign,
            contact,
            question: `Assistant follow-up commitment: ${event.transcript}`,
            source: "assistant_transcript"
          });
        }
        if (greetingFinished && isAssistantClosingIntent(event.transcript)) {
          closeAfterPlayback = true;
          callLog.endReason = callLog.endReason || "assistant_closing";
          callLog.endIntentDetectedAt = callLog.endIntentDetectedAt || nowIso();
        }
        callLog.updatedAt = nowIso();
        store.save();
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
      const itemId = event.item_id || "unknown";
      pendingInputTranscriptDeltas.set(itemId, `${pendingInputTranscriptDeltas.get(itemId) || ""}${event.delta}`);
      callLog.lastInputTranscriptionDeltaAt = nowIso();
      callLog.updatedAt = nowIso();
      store.save();
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript || pendingInputTranscriptDeltas.get(event.item_id || "unknown") || "").trim();
      pendingInputTranscriptDeltas.delete(event.item_id || "unknown");
      if (!transcript) {
        callLog.lastEmptyInputTranscriptAt = nowIso();
        callLog.updatedAt = nowIso();
        store.save();
        return;
      }
      if (shouldIgnoreCustomerAudio({ callMode, greetingFinished, lastAudioMarkSent, lastAudioMarkReceived })) {
        return;
      }
      appendTranscriptEntry(callLog, {
        role: "customer",
        text: transcript,
        at: nowIso(),
        source: "openai_realtime",
        eventType: event.type,
        itemId: event.item_id,
        contentIndex: event.content_index
      });
      if (isCustomerEndIntent(transcript)) {
        requestGoodbye("customer_done");
        return;
      }
      const result = answerQuestion({
        business,
        campaign,
        knowledgeBase,
        question: transcript
      });
      if (result.action === "opt_out") {
        contact.optedOut = true;
        contact.optedOutAt = nowIso();
      }
      if (result.followUpRequired) {
        ensureFollowUp({
          store,
          callLog,
          campaign,
          contact,
          question: transcript,
          source: "customer_transcript"
        });
      }
      callLog.updatedAt = nowIso();
      store.save();
      if (!closeAfterPlayback) armSilenceTimer();
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      if (shouldIgnoreCustomerAudio({ callMode, greetingFinished, lastAudioMarkSent, lastAudioMarkReceived })) {
        return;
      }
      clearSilenceTimer();
      if (streamSid) {
        twilioSocket.sendJson({ event: "clear", streamSid });
      }
      if (greetingFinished && activeResponse && !closeAfterPlayback) {
        activeResponse = false;
        openAiSocket.sendJson({ type: "response.cancel" });
      }
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      if (shouldIgnoreCustomerAudio({ callMode, greetingFinished, lastAudioMarkSent, lastAudioMarkReceived })) {
        return;
      }
      armSilenceTimer();
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.failed") {
      callLog.lastInputTranscriptionError = event.error || event;
      callLog.updatedAt = nowIso();
      store.save();
      return;
    }

    if (event.type === "error") {
      callLog.error = event.error?.message || JSON.stringify(event.error || event);
      callLog.lastOpenAiError = event.error || event;
      callLog.updatedAt = nowIso();
      store.save();
    }
  });

  twilioSocket.on("close", () => {
    if (openAiSocket) openAiSocket.close();
  });

  openAiSocket.on("close", () => {
    if (callLog.status === "in_progress") {
      callLog.status = "completed";
      callLog.twilioMediaChunksSent = twilioMediaChunksSent;
      callLog.updatedAt = nowIso();
      store.save();
    }
    twilioSocket.close();
  });

  openAiSocket.on("error", (error) => {
    callLog.error = error.message;
    callLog.updatedAt = nowIso();
    store.save();
    twilioSocket.close();
  });
}
