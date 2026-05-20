# CallerDesk MVP

Voice-first marketing MVP for small businesses that run popups, events, and sales.

The app lets a merchant:

- Create a popup or sale campaign.
- Upload opted-in customer contacts with consent source via CSV.
- Add approved knowledge-base answers.
- Preview the outbound call script.
- Schedule outbound voice calls through a telephony adapter.
- Review call logs and follow-up questions.

## Run locally

```sh
npm start
```

Open `http://localhost:5174`.

By default the app runs in `TELEPHONY_MODE=dry-run`, which creates local call logs without contacting a carrier. This keeps local demos safe while exercising the same scheduling flow.

Set `ADMIN_PASSWORD` in `.env` before exposing the dashboard on a public domain. Dashboard pages and API routes require login; Twilio `/voice/:callLogId` and `/media/:callLogId` remain public so calls can connect.

## Real outbound calls

Set the following environment variables before starting the server:

```sh
TELEPHONY_MODE=live
TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15551234567
PUBLIC_BASE_URL=https://my-business-ai.com
npm start
```

`PUBLIC_BASE_URL` must be reachable by Twilio because the app serves TwiML webhooks at `/voice/:callLogId`.

## OpenAI Realtime voice calls

For live AI phone conversations, the app returns Twilio `<Connect><Stream>` TwiML and bridges the Twilio media WebSocket to OpenAI Realtime.

Create a `.env` file from `.env.example` and set:

```sh
TELEPHONY_MODE=live
TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15551234567
PUBLIC_BASE_URL=https://my-business-ai.com
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_REALTIME_MODEL=gpt-realtime-mini
OPENAI_REALTIME_VOICE=coral
PORT=5174
```

Then run:

```sh
npm start
```

`PUBLIC_BASE_URL` must support both HTTPS requests and WSS WebSocket upgrades. A Cloudflare Tunnel public hostname for `my-business-ai.com` pointing to `http://localhost:5174` works for this.

When `OPENAI_API_KEY` and `PUBLIC_BASE_URL` are present, `/voice/:callLogId` streams the call to `/media/:callLogId`. Without those variables, the app falls back to the simpler Twilio `<Say>/<Gather>` flow.

## CSV format

Required columns:

```csv
name,phone,consent_source
```

Optional column:

```csv
tags
```

Tags can be separated with `;` or `|`.

## Test

```sh
npm test
```
