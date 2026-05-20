export function getTelephonyConfig(env = process.env) {
  const mode = env.TELEPHONY_MODE || "dry-run";
  const provider = env.TELEPHONY_PROVIDER || "twilio";
  const publicBaseUrl = env.PUBLIC_BASE_URL || "";
  const fromNumber = env.TWILIO_FROM_NUMBER || "";

  return {
    mode,
    provider,
    publicBaseUrl,
    fromNumber,
    liveReady:
      mode === "live" &&
      provider === "twilio" &&
      Boolean(env.TWILIO_ACCOUNT_SID) &&
      Boolean(env.TWILIO_AUTH_TOKEN) &&
      Boolean(publicBaseUrl)
  };
}

export class TelephonyAdapter {
  constructor({ env = process.env, fetchImpl = fetch } = {}) {
    this.env = env;
    this.fetch = fetchImpl;
    this.config = getTelephonyConfig(env);
  }

  status() {
    return {
      mode: this.config.mode,
      provider: this.config.provider,
      liveReady: this.config.liveReady,
      fromNumber: this.config.fromNumber || null,
      publicBaseUrl: this.config.publicBaseUrl || null
    };
  }

  async createCall({ contact, callLogId, fromNumber }) {
    if (this.config.mode !== "live") {
      return {
        provider: this.config.provider,
        providerCallId: `dry_${callLogId}`,
        status: "queued_local",
        note: "Dry-run mode queued the call without contacting a carrier."
      };
    }

    if (this.config.provider !== "twilio") {
      throw new Error(`Unsupported telephony provider: ${this.config.provider}`);
    }

    if (!this.config.liveReady) {
      throw new Error("Live telephony requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and PUBLIC_BASE_URL.");
    }

    const effectiveFromNumber = fromNumber || this.config.fromNumber;
    if (!effectiveFromNumber) {
      throw new Error("A workspace Twilio caller number is required before scheduling calls.");
    }

    const accountSid = this.env.TWILIO_ACCOUNT_SID;
    const authToken = this.env.TWILIO_AUTH_TOKEN;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const webhookUrl = `${this.config.publicBaseUrl.replace(/\/$/, "")}/voice/${callLogId}`;
    const body = new URLSearchParams({
      To: contact.phone,
      From: effectiveFromNumber,
      Url: webhookUrl,
      Method: "POST",
      StatusCallback: `${this.config.publicBaseUrl.replace(/\/$/, "")}/voice/${callLogId}/status`,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent: "initiated ringing answered completed"
    });

    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `Twilio call request failed with ${response.status}.`);
    }

    return {
      provider: "twilio",
      providerCallId: payload.sid,
      status: payload.status || "queued",
      webhookUrl
    };
  }

  async endCall({ providerCallId, status = "completed" }) {
    if (this.config.mode !== "live") {
      return {
        provider: this.config.provider,
        status,
        note: "Dry-run mode marked the call complete locally."
      };
    }

    if (this.config.provider !== "twilio") {
      throw new Error(`Unsupported telephony provider: ${this.config.provider}`);
    }

    if (!this.config.liveReady) {
      throw new Error("Live telephony requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and PUBLIC_BASE_URL.");
    }

    if (!providerCallId) {
      throw new Error("Cannot end a live call without a provider call id.");
    }

    const accountSid = this.env.TWILIO_ACCOUNT_SID;
    const authToken = this.env.TWILIO_AUTH_TOKEN;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${providerCallId}.json`;
    const body = new URLSearchParams({ Status: status });

    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `Twilio call update failed with ${response.status}.`);
    }

    return {
      provider: "twilio",
      providerCallId: payload.sid || providerCallId,
      status: payload.status || status
    };
  }
}
