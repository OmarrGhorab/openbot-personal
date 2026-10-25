import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "الـ OpenBot ده اتسجّل للوصول عن طريق WebRTC.",
  "status.host.keyRotated": "مفتاح السيرفر اتغيّر. الأجهزة المقترنة فاضلة مقترنة.",
  "status.host.identityUpdated": "هوية السيرفر اتحدّثت.",
  "status.host.starting": "بيشغّل الجهاز المضيف بتاع WebRTC…",
  "status.host.ready": "الـ OpenBot ده جاهز لاتصالات WebRTC.",
  "status.host.stopping": "بيخلّي الـ OpenBot ده خاص…",
  "status.host.private": "الـ OpenBot ده خاص.",
} as const satisfies PartialTranslation<typeof source>;
