import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/globalVoice";

export const messages = {
  "globalVoice.picker.label": "كلّم agent بصوتك",
  "globalVoice.picker.search": "دوّر على agent",
  "globalVoice.picker.searchPlaceholder": "اكتب اسم الـ agent",
  "globalVoice.picker.list": "الـ agents",
  "globalVoice.picker.empty": "مفيش agent بالاسم ده.",
  "globalVoice.picker.noAgents": "مفيش agent على الجهاز ده لسه.",
  "globalVoice.picker.hintChoose": "Enter أو رقم بيختار. Escape بيقفل.",
  "globalVoice.picker.hintListening": "اضغط الاختصار تاني أو Enter عشان تبعت. Escape بيلغي.",
  "globalVoice.picker.hintReview": "راجع الرسالة. Enter بيبعتها. Escape بيقفل.",
  "globalVoice.picker.preparing": "بجهّز الميكروفون",
  "globalVoice.picker.listening": "بسمع {agent}",
  "globalVoice.picker.transcribing": "بكتب اللي قلته",
  "globalVoice.picker.sending": "بابعت لـ {agent}",
  "globalVoice.picker.sent": "اتبعتت لـ {agent}",
  "globalVoice.picker.transcriptLabel": "الرسالة لـ {agent}",
  "globalVoice.picker.transcriptPlaceholder": "الرسالة هتظهر هنا",
  "globalVoice.picker.noSpeech": "مسمعتش كلام. جرّب تاني.",
  "globalVoice.picker.dictationFailed": "الإملاء بالصوت فشل. جرّب تاني.",
  "globalVoice.picker.sendFailed": "الرسالة متبعتتش. هي لسه هنا، تقدر تبعتها تاني.",

  "globalVoice.settings.title": "اختصار الصوت من أي مكان",
  "globalVoice.settings.enabled.title": "استخدم اختصارات الصوت",
  "globalVoice.settings.enabled.description": "لو مقفول، مفيش اختصار صوت هيشتغل، ومنهم اختصارات الـ agents.",
  "globalVoice.settings.dictation.title": "اختصار الإملاء",
  "globalVoice.settings.dictation.description":
    "بيبدأ الإملاء للـ agent الحالي على طول. اضغطه تاني عشان تبعت. Tab بيغيّر الـ agent وانت بتتكلم، وEscape بيلغي.",
  "globalVoice.settings.picker.title": "اختصار قايمة الـ agents",
  "globalVoice.settings.picker.description": "بيفتح قايمة الـ agents عشان تختار اللي هيستلم الرسالة.",
  "globalVoice.settings.sendAfterSpeaking.title": "ابعت بعد الكلام",
  "globalVoice.settings.sendAfterSpeaking.description":
    "أول ما تقف، الرسالة تتبعت للـ agent. لو مقفول، الرسالة تفضل في القايمة عشان تراجعها الأول.",
  "globalVoice.settings.record": "اضغط الاختصار",
  "globalVoice.settings.recordLabel": "غيّر الاختصار بتاع {name}",
  "globalVoice.settings.recordHint": "اضغط الزراير. Escape بيسيب الاختصار زي ما هو.",
  "globalVoice.settings.reset": "رجّعه",
  "globalVoice.settings.turnOff": "اقفله",
  "globalVoice.settings.needsModifier": "لازم تمسك Command أو Control أو Alt أو Shift مع الزرار.",
  "globalVoice.settings.keyNotAllowed": "الزرار ده مينفعش يبقى اختصار.",
  "globalVoice.settings.takenWarning":
    "برنامج تاني أو اختصار تاني واخد {accelerator}. اختار زرار تاني، وإلا الاختصار مش هيعمل حاجة.",
  "globalVoice.settings.saveFailed": "الاختصار متحفظش. جرّب تاني.",

  "globalVoice.agent.title": "اختصار الصوت من أي مكان",
  "globalVoice.agent.description": "بيبدأ الإملاء بالصوت للـ agent ده من أي برنامج، من غير القايمة.",
  "globalVoice.agent.none": "مفيش",
  "globalVoice.agent.saveFailed": "الاختصار متحفظش. جرّب تاني.",
  "globalVoice.agent.disabledHint": "شغّل اختصارات الصوت من الإعدادات > الصوت عشان تستخدمه.",
} satisfies PartialTranslation<typeof source>;
