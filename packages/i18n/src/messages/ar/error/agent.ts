import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "التاريخ مش متاح للطلب ده. اقرا التاريخ الأخير تاني، أو استخدم channel_history لشغل القناة.",
  "error.agent.toolRequestInvalid": "arguments اكتشاف الأداة مش صالحة. استخدم الـ schema المعلن واسم أداة مؤهّل أصلي.",
  "error.agent.boardTickets.noReviewer": "مفيش إيجنت تاني على موديل تاني يقدر يراجع التذكرة دي. ضيف واحد واطلب تاني.",
  "error.agent.boardTickets.notReviewThread": "بس تريد المراجعة اللي اتطلب للتذكرة دي يقدر يدي الحكم.",
  "error.agent.boardTickets.pullNeedsWorktree":
    "open_ticket_pull_request محتاج تذكرة GitHub، وworktree خاص بيها، واتصال GitHub.",
  "error.agent.boardTickets.notFound": "التذكرة مش موجودة. ممكن تكون اتمسحت.",
  "error.agent.boardTickets.emptyTitle": "اكتب عنوان للتذكرة.",
  "error.agent.boardTickets.emptyComment": "اكتب تعليق قبل ما تبعته.",
  "error.agent.boardTickets.alreadyStarted": "التذكرة دي ليها ثريد بالفعل.",
  "error.agent.boardTickets.startUnavailable": "التذاكر مش قادرة تبدأ ثريد على الجهاز ده.",
  "error.agent.boardTickets.threadFailed": "آخر دور في الثريد بتاعها فشل.",
  "error.agent.boardTickets.threadStopped": "الثريد بتاعها اتوقف قبل ما الشغل يخلص.",
  "error.agent.boardTickets.teamJobStopped": "شغلانة الفريق بتاعتها اتوقفت قبل ما الشغل يخلص.",
  "error.agent.boardTickets.teamJobNotDone": "شغلانة الفريق بتاعتها خلصت من غير ما تتم بعد آخر جولة FAIL.",
  "error.agent.boardTickets.toolInvalid":
    "اكتب حالة (backlog أو running أو needs_review)، أو سطر تقدّم 500 حرف على الأكتر، أو تعليق.",
  "error.agent.boardTickets.evidenceLimit": "التذكرة تشيل {count} دليل بالكتير.",
  "error.agent.boardTickets.evidenceNeedsFile": "لقطة الشاشة أو التسجيل محتاجين مسار ملف.",
  "error.agent.boardTickets.evidenceType":
    "نوع الملف ده مينفعش يبقى دليل. استخدم PNG أو JPEG أو WebP أو GIF للقطة الشاشة، وMP4 أو WebM أو MOV للتسجيل.",
  "error.agent.boardTickets.evidenceTooLarge": "الملف ده أكبر من {megabytes} ميجا.",
  "error.agent.boardTickets.evidenceTextTooLong":
    "ناتج الاختبار أو الـ diff يبقى {count} حرف بالكتير. حط الجزء المهم بس.",
  "error.agent.boardTickets.evidenceEmpty": "الدليل فاضي.",
  "error.agent.boardTickets.evidenceInvalid": "attach_ticket_evidence محتاج phase، ومسار أو نص.",
  "error.agent.boardTickets.evidenceNotFound": "الدليل ده مش موجود على الجهاز ده.",
  "error.agent.boardTickets.notTicketThread": "المهمة اللي شغّالة على تذكرة في لوحة التذاكر بس هي اللي تقدر تحدّثها.",
  "error.agent.boardTickets.syncNotConnected": "اربط نظام التذاكر ده على الجهاز ده الأول قبل ما تزامن معاه.",
  "error.agent.boardTickets.syncProjectInvalid": "اختار ريبو أو مشروع تزامن معاه.",
  "error.agent.boardTickets.syncProjectsFailed": "معرفناش نقرا ريبوهات نظام التذاكر.",
  "error.agent.boardTickets.syncFailed": "معرفناش نقرا الـ issues المفتوحة. المزامنة الجاية هتحاول تاني.",
  "error.agent.boardTickets.pushFailed": "معرفناش نبعت آخر تغيير للـ issue المربوطة.",
  "error.agent.approvalWhileDeleting": "مينفعش تدي موافقة والإيجنت بيتمسح.",
  "error.agent.accessLocalOnly": "صلاحيات الإيجنت ممكن تتغيّر بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.duplicateCleanupFailed": "تكرار الإيجنت فشل والنسخة الناقصة معرفتش تتمسح.",
  "error.agent.commitEffectsFailed": "المعاملة اتأكدت، بس التأثيرات المحفوظة بتاعتها فشلت.",
  "error.agent.settingsLocalOnly": "إعدادات الإيجنت ممكن تتغيّر بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.skillsLocalOnly": "المهارات ممكن تتغيّر بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.addLocalOnly": "الإيجنتات ممكن تتضاف بس على الجهاز اللي شغّالة عليه.",
  "error.agent.joinedServerUpdate": "إيجنت على سيرفر منضم إليه مينفعش يتحدّث من هنا.",
  "error.agent.searchQueryRequired": "لازم تكتب كلمة بحث.",
  "error.agent.messageTooLong": "الرسالة طويلة أوي.",
  "error.agent.messageOrAttachmentRequired": "لازم تكتب رسالة أو ترفق مرفق.",
  "error.agent.promptAnswersTooLong": "إجابات الـ prompt طويلة أوي.",
  "error.agent.gone": "الإيجنت ده مبقاش موجود.",
  "error.agent.profileGenerationBusy": "إنشاء البروفايل مشغول. جرّب تاني بعد شوية.",
  "error.agent.initialMessageRequired": "لازم تكتب الرسالة الأولى.",
  "error.agent.initialMessageTooLong": "الرسالة الأولى طويلة أوي.",
  "error.agent.setupCleanupFailed": "إعداد الإيجنت فشل والإيجنت الناقص معرفش يتمسح.",
  "error.agent.modelUnavailable": "موديل الإيجنت اللي اخترته مش متاح.",
  "error.agent.modelProviderNotConnected": "موديل الإيجنت اللي اخترته «{model}» مش متاح: {provider} مش متصل.",
  "error.agent.modelListEmpty":
    "موديل الإيجنت اللي اخترته «{model}» مش متاح: {provider} مرجّعش أي موديلات. آخر خطأ: {detail}",
  "error.agent.modelListEmptyNoError": "موديل الإيجنت اللي اخترته «{model}» مش متاح: {provider} مرجّعش أي موديلات.",
  "error.agent.modelNotInProviderList": "موديل الإيجنت اللي اخترته «{model}» مش متاح: {provider} مش عارضه في قايمته.",
  "error.agent.modelProviderMismatch": "الموديل اللي اخترته مش تابع للمزوّد ده.",
  "error.agent.modelNotListed": "الموديل «{model}» مش متاح. الموديلات المتاحة: {models}.",
  "error.agent.providerNotListed":
    "مفيش موديل من {provider} متاح دلوقتي. نادي list_models علشان تشوف الموديلات المتاحة.",
  "error.agent.reasoningEffortUnsupported":
    "الموديل «{model}» مبيدعمش جهد التفكير «{effort}». الجهود المدعومة: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} مفيهوش موديل متاح، ومفيش مزوّد تاني مسجّل دخول فيه موديل. سجّل دخول لمزوّد، أو غيّر المزوّد الافتراضي من إعدادات السيرفر ← المزوّدين.",
  "error.agent.noStartingModel":
    "{provider} مفيهوش موديل متاح، ومفيش مزوّد تاني مسجّل دخول فيه موديل. سجّل دخول لمزوّد، أو غيّر المزوّد الافتراضي من المزوّدين والأذونات.",
  "error.agent.waitBeforeProviderChange": "استنى لحد ما الدور الشغّال والطابور يخلصوا قبل ما تغيّر المزوّد.",
  "error.agent.waitForTasksBeforeProviderChange":
    "مهام الإيجنت ده شغّالة. استنى لحد ما تخلص، أو وقّفها، قبل ما تغيّر المزوّد.",
  "error.agent.waitBeforeClearContext": "استنى لحد ما الدور الشغّال والطابور يخلصوا قبل ما تبدأ شات جديد.",
  "error.agent.waitBeforeCompactContext": "استنى لحد ما الدور الشغّال والطابور يخلصوا قبل ما تضغط السياق.",
  "error.agent.compactContextUnavailable": "الإيجنت ده مش قادر يضغط السياق بتاعه دلوقتي.",
  "error.agent.unknown": "إيجنت مش معروف: {id}",
  "error.agent.onlyUserWidensSettings":
    "المستخدم بس هو اللي يقدر يدّي إيجنت وصول كامل أو يشغّل استخدام الكمبيوتر. اطلب من المستخدم يغيّره من إعدادات الإيجنت.",
  "error.agent.queuedMessageCreateFailed": "معرفتش أعمل رسالة في الطابور.",
  "error.agent.messageUnavailable": "الرسالة مبقتش متاحة.",
  "error.agent.hostLimit": "الجهاز المضيف يقدر يكون عنده {limit} إيجنت على الأكتر.",
  "error.agent.changedWhileDuplicating": "الإيجنت اتغيّر وهو بيتكرر. جرّب تاني.",
  "error.agent.duplicatedAgentGone": "الإيجنت المكرر مبقاش موجود.",
  "error.agent.stateCorrupt": "حالة الإيجنت تالفة أو من نسخة OpenBot أحدث، ومش هكتب فوقها.",
  "error.agent.oldRoleField": "بروفايلات الإيجنت المخزنة بتستخدم حقل role القديم؛ حدّث البيانات قبل ما تشغّل OpenBot.",
  "error.agent.duplicateIds": "حالة الإيجنت فيها معرّفات إيجنت مكررة؛ مش هكتب فوقها.",
  "error.agent.copyNameFailed": "OpenBot معرفش يعمل اسم نسخة إيجنت مميز.",
  "error.agent.endpointRemoved": "الـ endpoint اللي كان الإيجنت ده بيستخدمه اتشال. اختار له موديل تاني.",
  "error.agent.turnStalled": "{provider} وقف عن الرد، فـ OpenBot خلّص الدور ده. ابعت الرسالة تاني، أو اختار موديل تاني.",
  "error.agent.selectedGone": "الإيجنت اللي اخترته مبقاش موجود.",
  "error.agent.profileEndpointsChanged": "الـ endpoints المخصصة اتغيّرت وإنت بتعمل ده. جرّب تاني.",
  "error.agent.profileInvalid": "المزوّد رجّع بروفايل مش صالح. جرّب تعدّل الـ prompt.",
  "error.agent.profileSectionUnavailable": "القسم المتولّد مش متاح. جرّب تاني أو اختار قسم بإيدك.",
  "error.agent.profileTimedOut": "إنشاء البروفايل خد وقت أطول من اللازم. جرّب تاني.",
  "error.agent.profileDisconnected": "المزوّد فصل وهو بيعمل البروفايل.",
  "error.agent.profileToolUse": "المزوّد حاول يستخدم أداة. جرّب تعدّل الـ prompt.",
  "error.agent.profileFailed": "المزوّد معرفش يعمل بروفايل. جرّب تاني.",
  "error.agent.profileTooLarge": "البروفايل المتولّد كبير أوي. جرّب prompt أقصر.",
  "error.agent.profileNotStarted": "المزوّد معرفش يبدأ إنشاء البروفايل.",
  "error.agent.deletionBusy": "حذف الإيجنت شغّال بالفعل.",
  "error.agent.stopBeforeDelete": "وقّف الإيجنت والغي الرسايل اللي في الطابور بتاعه قبل ما تمسحه.",
  "error.agent.deleteIncomplete": "بيانات الإيجنت معرفتش تتمسح بالكامل. جرّب تمسح الإيجنت تاني.",
  "error.agent.duplicationBusy": "الإيجنت ده بيتكرر بالفعل.",
  "error.agent.waitBeforeDuplicate": "استنى لحد ما الإيجنت يخلص وفضّي الطابور بتاعه قبل ما تكرره.",
  "error.agent.saveOtherAgent": "الحفظ ده تابع لإيجنت تاني.",
  "error.agent.savedGone": "الإيجنت المحفوظ مبقاش موجود.",
  "error.agent.storedProfileUnreadable":
    "بروفايل إيجنت مخزن فيه قيمة «{field}» مش مقروءة؛ حدّث البيانات قبل ما تشغّل OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "بروفايل الإيجنت المخزن {id} فيه قيمة «{field}» مش مقروءة؛ حدّث البيانات قبل ما تشغّل OpenBot.",
  "error.agent.queueEditRejected": "تعديل الطابور اترفض: {reason}",
  "error.agent.computerUseLocalOnly": "استخدام الكمبيوتر ممكن يتغيّر بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.automationLocalOnly": "السكريبتات المحلية ممكن تتسمح بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.newChatLocalOnly": "الجهاز اللي شغّال عليه الإيجنت بس هو اللي يقدر يخليه يبدأ شاتات جديدة.",
  "error.agent.quickAcknowledgementLocalOnly": "الجهاز اللي شغّال عليه الإيجنت بس هو اللي يقدر يغيّر الإعداد ده.",
  "error.agent.sideQuestionBusy": "فيه أسئلة جانبية كتير شغّالة. جرّب تاني بعد شوية.",
  "error.agent.sideQuestionFailed": "الإيجنت معرفش يرد على السؤال الجانبي. جرّب تاني.",
  "error.agent.busyMessageModeLocalOnly":
    "اللي بتعمله الرسايل وقت ما الإيجنت شغّال ممكن يتظبط بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.backupModelsLocalOnly": "الموديلات الاحتياطية ممكن تتظبط بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.taskLimitLocalOnly": "حد المهام ممكن يتظبط بس على الجهاز اللي شغّال عليه الإيجنت.",
  "error.agent.localScriptsOff": "الإيجنت ده مبيسمحش بالسكريبتات المحلية.",
  "error.agent.localScriptsRateLimited":
    "السكريبتات المحلية بعتت للإيجنت ده {limit} طلب رسالة أو روتين في آخر ساعة. جرّب تاني بعدين.",
  "error.agent.automationOff": "الإيجنت ده مبيسمحش للسكريبتات المحلية بتشغيل الروتينات بتاعته.",
  "error.agent.automationPayloadTooLong": "الـ payload أطول من {limit} حرف.",
  "error.agent.automationRateLimited":
    "السكريبتات المحلية شغّلت روتينات الإيجنت ده {limit} مرة في آخر ساعة. جرّب تاني بعدين.",
  "error.agent.workspaceOnlyMacOnly":
    "وضع مساحة العمل بس متاح للمزوّد ده على macOS بس. اختار وصول كامل من إعدادات الإيجنت.",
  "error.agent.lowMemory":
    "السيرفر ده ذاكرته قليلة. رسالتك مستنية في الطابور وهتبدأ لما الذاكرة تفضى. باقة أكبر بتدّي السيرفر ذاكرة أكتر.",
  "error.agent.lowMemoryServer": "السيرفر ده ذاكرته قليلة. رسالتك مستنية في الطابور وهتبدأ لما الذاكرة تفضى.",
  "error.agent.workspaceOnlyToolMissing":
    "وضع مساحة العمل بس محتاج {tool}، وOpenBot ملقاهوش. ثبّته، أو اختار وصول كامل من إعدادات الإيجنت.",
  "error.agent.screenCaptureOff":
    "التقاط الشاشة مقفول للإيجنت ده. المستخدم يقدر يشغّل استخدام الكمبيوتر من إعدادات الإيجنت.",
  "error.agent.screenCaptureUnavailable": "التقاط الشاشة مش متاح على الجهاز ده.",
  "error.agent.screenCaptureShared":
    "التقاط الشاشة مبيشتغلش في محادثة Slack أو Discord أو Telegram، لأن ناس تانية بتاخد ملفاته.",
  "error.agent.screenCaptureDeclined": "المستخدم ماسمحش بالتقاط الشاشة ده. مفيش حاجة اتلقطت.",
  "error.agent.mcpServerDeclined": "المستخدم ماسمحش بتغيير سيرفر MCP ده. مفيش حاجة اتغيّرت.",
  "error.agent.mcpServerNotSaved": "سيرفر MCP ماردّش، فماتحفظش. {error}",
  "error.agent.mcpServerKeysMove":
    "سيرفر MCP {name} شايل مفاتيح للسيرفر الحالي بتاعه. اطلب من المستخدم يغيّر العنوان أو الأمر أو الـ arguments أو النقل بتاعه من إعدادات السيرفر، MCP.",
  "error.agent.mcpServerUnknown": "مفيش سيرفر MCP اسمه {name}. نادي list_mcp_servers علشان تشوف الأسماء.",
  "error.agent.screenCaptureWindowMissing":
    "النافذة دي مش مفتوحة دلوقتي. نادي list_capture_sources علشان تجيب معرّفات النوافذ الحالية.",
  "error.agent.screenCaptureDisplayMissing":
    "الشاشة دي مش متوصّلة دلوقتي. نادي list_capture_sources علشان تجيب معرّفات الشاشات الحالية.",
  "error.agent.screenCaptureRegionOutside":
    "المنطقة مش جوه شاشة واحدة. استخدم نقاط سطح المكتب جوه حدود شاشة واحدة من list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot معندوش إذن Screen Recording. اطلب من المستخدم يفتح System Settings > Privacy & Security > Screen & System Audio Recording، ويشغّل OpenBot، وبعدين يقفل OpenBot ويفتحه تاني.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows رجّع صورة فاضية. اطلب من المستخدم يفتح قفل الكمبيوتر ويقفل المحتوى المحمي. وكمان سياسة المؤسسة ممكن توقّف التقاط الشاشة.",
  "error.agent.screenCaptureFailed": "التقاط الشاشة فشل. جرّب تاني.",
  "error.agent.ravenTeam.workspaceAccess":
    "{role} مينفعش يشتغل قراءة بس مع {provider} على {os}، علشان كده الفريق مابدأش. ادّيله وصول كامل من كارت التأكيد أو اختار مزوّد بيدعم القراءة بس.",
  "error.agent.ravenTeam.workspaceAccessHere":
    "على الجهاز ده، {role} مينفعش يشتغل قراءة بس مع {provider}، علشان كده الفريق مابدأش. ادّيله وصول كامل من كارت التأكيد أو اختار مزوّد بيدعم القراءة بس.",
  "error.agent.autopilot.noType":
    "الأوتوبايلوت ساب التذكرة دي في Backlog: نوعها مش متحدد والنص مش بيقول. حدّد Feature أو Bug أو Chore والأوتوبايلوت هياخدها.",
  "error.agent.autopilot.startFailed": "الأوتوبايلوت معرفش يبدأ فريق للتذكرة دي: {reason}",
  "error.agent.autopilot.roundLimit":
    "الأوتوبايلوت وقف بعد {rounds} جولات من غير PASS. اقرا آخر مراجعة، وبعدين ابدأ التذكرة تاني أو غيّرها.",
  "error.agent.autopilot.needsYou": "الأوتوبايلوت محتاجك: دور في الفريق سأل سؤال. جاوبه في ثريد الفريق.",
  "error.agent.autopilot.passed": "الأوتوبايلوت خلّص: المراجعة عدّت. التذكرة جاهزة لمراجعتك.",
  "error.agent.autopilot.usageLimit":
    "الأوتوبايلوت وقّف التذاكر الجديدة: حد الاستخدام عند مزوّد موقّف دور في الشغلانة دي. هيكمّل لما المزوّد يسمح بالشغل تاني.",
  "error.agent.autopilot.reason.featureLarge":
    "ميزة بتلمس ملفات أو حزم كتير، علشان كده فريق Raven Stack الكامل بيخطّط الأول وموديل تاني بيراجع.",
  "error.agent.autopilot.reason.featureFiles":
    "ميزة بتلمس {count} ملفات، علشان كده فريق Raven Stack الكامل بيخطّط الأول وموديل تاني بيراجع.",
  "error.agent.autopilot.reason.featureSmall": "ميزة صغيرة، علشان كده Autopilot lite بيبنيها وموديل تاني بيراجع.",
  "error.agent.autopilot.reason.bugFailingCase":
    "التذكرة فيها حالة بتفشل، علشان كده pstack · tdd بيكتب الاختبار اللي بيفشل الأول ويصلّح أصل المشكلة.",
  "error.agent.autopilot.reason.bugInvestigate":
    "باج من غير حالة بتفشل، علشان كده فريق Raven Stack الكامل بيحقّق قبل ما يبني.",
  "error.agent.autopilot.reason.choreSmall": "مهمة روتينية، علشان كده Autopilot lite بيعملها على موديلات صغيرة.",
  "error.agent.autopilot.reason.override": "إعدادات الأوتوبايلوت بتاعتك محدّدة الستاك لنوع التذكرة ده.",
  "error.agent.autopilot.reason.manualStack":
    "الستاك التلقائي مقفول في إعدادات الأوتوبايلوت بتاعتك، علشان كده فريق Raven Stack الكامل هو اللي بيشتغل.",
  "error.agent.autopilot.merged":
    "اتعمل Merge بواسطة الـ Reviewer: {method} merge لطلب الدمج {number}، بعد PASS على آخر commit وCI أخضر. التذكرة خلصت.",
  "error.agent.autopilot.mergeBlocked.newCommit":
    "الـ Reviewer معملش Merge: جه commit جديد بعد الـ PASS. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.ciFailing":
    "الـ Reviewer معملش Merge: فحص CI فشل. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.ciMissing":
    "الـ Reviewer معملش Merge: آخر commit مفيهوش أي فحص CI. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.ciTimeout":
    "الـ Reviewer معملش Merge: الـ CI مخلصش في 30 دقيقة. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.noPullRequest":
    "الـ Reviewer معملش Merge: الـ Builder مذكرش أي pull request على GitHub. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.pullRequestClosed":
    "الـ Reviewer معملش Merge: الـ pull request مقفول أو اتعمله Merge قبل كده. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.notConnected":
    "الـ Reviewer معملش Merge: GitHub مش متوصّل على الكمبيوتر ده. وصّله من الإعدادات. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.mergeBlocked.refused":
    "الـ Reviewer معملش Merge: GitHub رفض الـ Merge. التذكرة مستنياك في Needs review.",
  "error.agent.autopilot.reason.pstackMissing":
    "التذكرة تناسب pstack، بس مهارات pstack مش متثبّتة، علشان كده Autopilot lite هو اللي بيشتغل عليها. ثبّت pstack من Skills علشان تستخدمه المرة الجاية.",
  "error.agent.autopilot.pstackMissing":
    "مهارة {skill} مش متثبّتة، علشان كده Autopilot lite بيشتغل على التذكرة دي بدل pstack. ثبّت pstack من Skills، والتذكرة الجاية تقدر تستخدمه.",
  // Chat (#200): why a ticket from a chat message did not start.
  "error.agent.ticketTake.notFound": "التذكرة مش موجودة على اللوحة.",
  "error.agent.ticketTake.githubOnly": "من الشات تقدر تاخد تذاكر GitHub بس. حط لينك الـ issue.",
  "error.agent.ticketTake.closed": "الـ issue دي مقفولة أو مش مفتوحة في الريبو المتوصل.",
  "error.agent.ticketTake.alreadyRunning": "التذكرة دي شغالة بالفعل في تريد تاني.",
  "error.agent.ticketTake.noAgent": "الإيجنت بتاع الشات ده مش على الجهاز ده.",
  "error.agent.ticketTake.failed": "معرفتش آخد التذكرة. ابعت الرسالة تاني.",
} as const satisfies PartialTranslation<typeof source>;
