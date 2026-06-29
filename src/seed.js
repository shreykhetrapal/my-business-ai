export const initialState = {
  business: {
    id: "biz_demo",
    name: "Mina's Corner Cafe",
    phone: "+14155550129",
    timezone: "America/Los_Angeles",
    callerId: "Mina from Mina's Corner Cafe",
    defaultCallWindow: {
      start: "10:00",
      end: "18:00"
    }
  },
  contacts: [
    {
      id: "contact_ava",
      name: "Ava Patel",
      phone: "+14155550101",
      consentSource: "loyalty signup",
      tags: ["regular", "coffee"],
      optedOut: false,
      createdAt: "2026-05-19T00:00:00.000Z"
    },
    {
      id: "contact_noah",
      name: "Noah Lee",
      phone: "+14155550102",
      consentSource: "event RSVP",
      tags: ["popup"],
      optedOut: false,
      createdAt: "2026-05-19T00:00:00.000Z"
    }
  ],
  campaigns: [
    {
      id: "campaign_latte_popup",
      name: "Saturday Latte Art Popup",
      type: "event",
      status: "draft",
      eventDate: "2026-05-23T16:00",
      location: "Mina's Corner Cafe, 18 Oak Street",
      offer: "Free mini pastry with any specialty latte while supplies last",
      objective: "Invite regulars to the Saturday latte art popup and answer questions.",
      scriptNotes: "Keep the tone warm and personal. Mention that seating is limited.",
      targetTags: ["regular", "popup"],
      createdAt: "2026-05-19T00:00:00.000Z"
    }
  ],
  knowledgeBase: [
    {
      id: "kb_menu",
      scope: "campaign_latte_popup",
      topic: "menu",
      question: "What drinks are available?",
      answer: "The popup menu includes vanilla bean lattes, cardamom cold brew, matcha lattes, and decaf espresso drinks.",
      createdAt: "2026-05-19T00:00:00.000Z"
    },
    {
      id: "kb_reservations",
      scope: "campaign_latte_popup",
      topic: "reservations",
      question: "Do I need a reservation?",
      answer: "Reservations are not required, but arriving near the 4 PM start is recommended because seating is limited.",
      createdAt: "2026-05-19T00:00:00.000Z"
    }
  ],
  callLogs: [],
  followUps: [],
  messagingSenders: [],
  messageThreads: [],
  messageLogs: []
};
