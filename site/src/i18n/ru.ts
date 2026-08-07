/**
 * Russian translations, keyed by the key used at the call site.
 *
 * A key that is absent renders the English written in the component, and the
 * build prints it as a warning. Strings whose English was rewritten are left
 * out on purpose: the build log is the to-do list for the next translation pass.
 */
export const ru: Record<string, string> = {
  "meta.title": "Rejudge — независимая проверка для ИИ-агентов",

  "hero.linksLabel": "Ссылки проекта",

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
  "flow.agent": "Ваш агент",
  "flow.asksQuestion": "задаёт вопрос",
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

  "install.eyebrow": "Быстрый старт",
  "install.copy": "Копировать",
  "install.copied": "✓ Скопировано",
  "install.step1.title": "Установите Rejudge",
  "install.step4.title": "Задайте вопрос",

  "connect.personalNote": `“Я сам пользуюсь <a href="https://opencode.ai/go" target="_blank" rel="noreferrer">OpenCode Go</a>, потому что за $10 в месяц он даёт отличный набор разных моделей.”`,
  "connect.subscriptionSummary": "Используете подписку вместо API-ключей?",
  "connect.subscriptionIntro": `Для входа по <a href="https://pi.dev/docs/latest/providers#subscriptions" target="_blank" rel="noreferrer">подписке</a> Rejudge пока использует Pi. Если Pi ещё не авторизован, запустите:`,
  "connect.login": `В Pi выполните <code>/login</code> и завершите вход у нужного провайдера подписки.`,

  "configure.path": `Один раз создайте <code>~/.config/rejudge/config.json</code>.`,

  "footer.license": "Лицензия MIT",
};
