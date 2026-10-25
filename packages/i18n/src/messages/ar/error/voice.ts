import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "معرفتش أنزّل موديل الصوت. جرّب تاني.",
  "error.voice.downloadStopped": "تنزيل موديل الصوت اتوقف.",
  "error.voice.removeBusy": "استنى لحد ما تحويل الصوت لنص يخلص، وبعدين امسح الموديل.",
  "error.voice.removeFailed": "معرفتش أمسح موديل الصوت. جرّب تاني.",
  "error.voice.runtimeUnavailable": "تحويل الصوت لنص محليًا مش متاح على المنصة دي.",
  "error.voice.busy": "فيه تحويل صوت لنص شغّال بالفعل.",
  "error.voice.modelUnavailable": "موديل الصوت مش متاح.",
  "error.voice.transcriptionTimedOut": "تحويل الصوت لنص خد وقت أطول من اللازم.",
  "error.voice.prepareRequired": "تحويل الصوت لنص محليًا مش متاح. شغّل `bun run voice:prepare` واعمل restart لـ OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot معرفش يحوّل التسجيل ده لنص.",
  "error.voice.cloud.keyRequired": "ضيف مفتاح ElevenLabs API من الإعدادات ← الصوت.",
  "error.voice.cloud.keyRejected": "ElevenLabs ماقبلش مفتاح API. اتأكد من المفتاح في الإعدادات ← الصوت.",
  "error.voice.cloud.quotaExceeded": "حصة ElevenLabs بتاعتك خلصت.",
  "error.voice.cloud.rateLimited": "ElevenLabs مشغول. جرّب تاني بعد شوية.",
  "error.voice.cloud.termsRequired": "وافق على شروط ElevenLabs في حسابك على ElevenLabs، وبعدين جرّب تاني.",
  "error.voice.cloud.streamEnded": "stream الإملاء خلص. سجّل تاني.",
  "error.voice.cloud.tooLong": "التسجيل طويل أوي.",
  "error.voice.cloud.keySaveFailed": "معرفتش أحفظ مفتاح ElevenLabs API.",
  "error.voice.speech.runtimeUnavailable": "الكلام المحلي مش متاح على المنصة دي.",
  "error.voice.speech.modelRequired": "نزّل موديل الكلام من الإعدادات ← الصوت.",
  "error.voice.speech.timedOut": "قراءة الردّ بصوت عالي خدت وقت أطول من اللازم.",
  "error.voice.speech.failed": "OpenBot معرفش يقرا الردّ بصوت عالي.",
  "error.voice.recordingNotKept": "OpenBot معرفش يحتفظ بالتسجيل الصوتي.",
} as const satisfies PartialTranslation<typeof source>;
