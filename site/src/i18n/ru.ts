/**
 * Russian translations, keyed by the key used at the call site.
 *
 * A key that is absent renders the English written in the component, and the
 * build prints it as a warning. Strings whose English was rewritten are left
 * out on purpose: the build log is the to-do list for the next translation pass.
 */
export const ru: Record<string, string> = {
  "meta.title": "Rejudge — независимая проверка для ИИ-агентов",
  "meta.description":
    "Rejudge — независимая проверка для агентов, которые пишут код. Ваш агент задаёт вопрос, несколько моделей разбирают код по отдельности, а судья сравнивает их выводы и возвращает один ответ.",

  "meta.imageAlt": "Логотип Rejudge над записью терминала с настоящим запуском проверки.",

  "hero.linksLabel": "Ссылки проекта",
  "hero.themeToggle": "Переключить тему",
  "hero.tagline":
    "Rejudge — независимая проверка для агентов, которые пишут код. Ваш агент задаёт вопрос, несколько моделей разбирают код по отдельности, а судья сравнивает их выводы и возвращает один ответ.",

  "run.caption":
    "Настоящий запуск: три модели сверяют shipping.js со спецификацией, потом судья пишет ответ.",

  "why.eyebrow": "Зачем несколько моделей",
  "why.intro":
    "Код, который написал агент, можно проверить четырьмя способами. Каждый следующий ловит больше предыдущего.",

  "why.1.lead": "Та же сессия, та же модель.",
  "why.1.body":
    "Агент перечитывает свой код. Он уже решил, что код правильный, и повторное чтение это решение не меняет.",

  "why.2.lead": "Новая сессия, та же модель.",
  "why.2.body":
    "Контекст чистый, модель прежняя. У неё то же обучение и те же привычки, поэтому она пропускает ошибки, которые написала бы сама.",

  "why.3.lead": "Другая модель, отдельная сессия.",
  "why.3.body":
    "Другая модель действительно находит настоящие ошибки. Но теперь у вас два мнения, и когда они расходятся, решать, кто прав, приходится вам.",

  "why.4.lead": "три модели и судья.",
  "why.4.body":
    "Все три модели получают один и тот же вопрос одновременно. Каждая работает в изолированном контексте и сама вызывает инструменты, поэтому ни одна не видит, что делают другие. Судья читает все три отчёта, задаёт уточняющие вопросы там, где они расходятся, и пишет один ответ. Если одну и ту же проблему нашли все три, на ней сошлись три независимые проверки. Если они разошлись, разбирается судья, а не вы.",

  "flow.eyebrow": "Как это работает",
  "flow.ariaLabel":
    "Rejudge отправляет один вопрос нескольким отдельным моделям, затем судья сравнивает их выводы и возвращает один ответ.",
  "flow.agent": "Ваш агент",
  "flow.asksQuestion": "задаёт вопрос",
  "flow.writesFindings": "пишет свои выводы",
  "flow.model.1": "Модель X",
  "flow.model.2": "Модель Y",
  "flow.model.3": "Модель Z",
  "flow.judge": "Судья",
  "flow.comparesFindings": "сравнивает выводы",
  "flow.answer": "Ответ",
  "flow.answerDescription": "с учётом всех выводов",
  "flow.runId.1": "+ ID запуска",
  "flow.runId.2": "для продолжения",
  "flow.followUp.1": "задаёт дополнительные вопросы",
  "flow.followUp.2": "когда выводы расходятся",
  "flow.summary":
    "Проверяющие модели получают инструменты только на чтение: read, grep, find, ls, git diff. По умолчанию они не могут править файлы и выполнять команды. У судьи доступа к рабочей папке нет вообще: он видит три отчёта и может задать проверяющим ещё вопросы, больше ничего. Каждый запуск заканчивается ID запуска, и rejudge --resume <run-id> открывает те же сессии с новым вопросом.",

  "install.eyebrow": "Быстрый старт",
  "install.copy": "Копировать",
  "install.copied": "✓ Скопировано",
  "install.step1.title": "Установите Rejudge",
  "install.step2.title": "Подключите провайдера",
  "install.step3.title": "Выберите модели",
  "install.step4.title": "Задайте вопрос",

  "install.skills": `Работаете с агентом не на Pi? Установите Agent Skills через <a href="https://www.skills.sh/docs/cli" target="_blank" rel="noreferrer">Skills CLI</a>, чтобы он мог вызывать Rejudge. Pi для этого не нужен.`,
  "install.skillsUpdate": `Скиллы — отдельная копия, поэтому после каждого выпуска Rejudge обновляйте их командой <code>npx skills update -g -y</code>.`,
  "install.pi": `Уже пользуетесь Pi? Подключите эту же установку: <code>pi install "$(npm root -g)/rejudge"</code>`,

  "connect.env":
    "Rejudge работает поверх Pi и читает его настройки провайдеров, поэтому подойдёт любой ключ, который понимает Pi:",
  "connect.envMore": `и другие — полный список в <a href="https://pi.dev/docs/latest/providers#api-keys" target="_blank" rel="noreferrer">документации Pi</a>.`,
  "connect.personalNote": `Я сам пользуюсь <a href="https://opencode.ai/go?ref=GSCMBMGRST" target="_blank" rel="noreferrer sponsored">OpenCode Go</a>, потому что за $10 в месяц он даёт отличный набор разных моделей (реферальная ссылка: $5 вам, $5 мне).`,
  "connect.subscriptionSummary": "Используете подписку вместо API-ключей?",
  "connect.subscriptionIntro": `Для входа по <a href="https://pi.dev/docs/latest/providers#subscriptions" target="_blank" rel="noreferrer">подписке</a> Rejudge пока использует Pi. Если Pi ещё не авторизован, запустите:`,
  "connect.login": `В Pi выполните <code>/login</code> и завершите вход у нужного провайдера подписки.`,

  "configure.path": `Один раз создайте <code>~/.config/rejudge/config.json</code>.`,
  "configure.levels":
    "Минимум две проверяющие модели. Каждой нужен уровень рассуждений — чем он выше, тем дольше и тщательнее разбор:",

  "ask.body": `Ответ уходит в stdout, а прогресс, конфигурация и ID запуска — в stderr, поэтому при перенаправлении stdout в файл там остаётся только ответ. В Pi тот же пакет регистрирует встроенный инструмент <code>rejudge</code> и сценарии <code>/rejudge</code> и <code>/rejudge-diff</code>.`,

  "footer.license": "Лицензия MIT",
};
