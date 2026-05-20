export function appendTranscriptEntry(callLog, entry) {
  const text = String(entry.text || "").trim();
  if (!text) return null;

  const at = entry.at || new Date().toISOString();
  const transcriptEntry = {
    role: entry.role,
    text,
    at
  };
  const rawEntry = {
    ...transcriptEntry,
    source: entry.source || "app",
    eventType: entry.eventType || "",
    itemId: entry.itemId || "",
    contentIndex: entry.contentIndex ?? null
  };

  callLog.transcript ||= [];
  callLog.rawTranscript ||= [];
  callLog.transcript.push(transcriptEntry);
  callLog.rawTranscript.push(rawEntry);
  return rawEntry;
}

export function transcriptEntries(callLog) {
  return callLog.rawTranscript?.length ? callLog.rawTranscript : callLog.transcript || [];
}
