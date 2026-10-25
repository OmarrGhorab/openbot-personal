import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "نسخة OpenBot دي مفيهاش GitHub App.",
  "error.connector.githubDenied": "تسجيل الدخول بـ GitHub اترفض.",
  "error.connector.githubCodeExpired": "كود GitHub انتهت صلاحيته. وصّل GitHub تاني.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App مبيسمحش بتسجيل الدخول من الجهاز.",
  "error.connector.githubClientUnknown": "GitHub مش عارف الـ Client ID بتاع GitHub App ده.",
  "error.connector.githubUnexpected": "GitHub بعت ردّ مش متوقع: {detail}",
  "error.connector.githubUnreachable": "OpenBot مش قادر يوصل لـ GitHub: {detail}",
  "error.connector.githubExpired": "اتصال GitHub انتهى. وصّل GitHub تاني.",
  "error.connector.githubFileUnreadable": "ملف اتصال GitHub مش ممكن يتقري.",
  "error.connector.githubFileTooLarge": "ملف اتصال GitHub كبير أوي.",
  "error.connector.onePasswordCliMissing":
    "OpenBot مش لاقي 1Password CLI. ثبّته وفعّل التكامل بتاعه في تطبيق 1Password، أو استخدم service account token.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot معرفش يثبّت 1Password CLI. اتأكد من اتصال الإنترنت، وبعدين جرّب تاني.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI مش مسجّل دخول. فعّل التكامل بتاعه في تطبيق 1Password، وبعدين اتصل تاني.",
  "error.connector.onePasswordCliFailed": "1Password CLI فشل: {detail}",
  "error.connector.onePasswordUnexpected": "1Password بعت ردّ مش متوقع: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password ماقبلش service account token.",
  "error.connector.onePasswordNoVault":
    "الـ service account مش قادر يقرا أي vault. اديله صلاحية على vault، وبعدين جرّب تاني.",
  "error.connector.onePasswordFileUnreadable": "ملف اتصال 1Password مش ممكن يتقري.",
  "error.connector.onePasswordFileTooLarge": "ملف اتصال 1Password كبير أوي.",
  "error.connector.bitwardenFailed":
    "معرفتش أقرا Bitwarden. ثبّت bw CLI، وسجّل دخول، وافتح قفله، واعمل فولدر واحد اسمه Shared with OpenBot. اتصل بمفتاح جلسة جديد.",
  "error.connector.bitwardenHostInput":
    "اكتب عنوان سيرفر HTTPS، وclient_id وclient_secret بتوع مفتاح API، والباسورد الرئيسي.",
  "error.connector.bitwardenHostFailed":
    "معرفتش أفتح Bitwarden على السيرفر ده. اتأكد من عنوان السيرفر ومفتاح API والباسورد الرئيسي، وإن فولدر واحد اسمه Shared with OpenBot. وبعدين اتصل تاني.",
  "error.connector.bitwardenCliInstallFailed":
    "معرفتش أثبّت Bitwarden CLI على السيرفر ده. اتأكد من اتصاله بالشبكة، وبعدين اتصل تاني.",
  "error.connector.bitwardenFileUnreadable": "ملف اتصال Bitwarden مش ممكن يتقري.",
} as const satisfies PartialTranslation<typeof source>;
