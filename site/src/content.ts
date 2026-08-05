export type Locale = "en" | "ru";

export type SiteContent = {
  locale: Locale;
  lang: string;
  ogLocale: string;
  path: string;
  alternatePath: string;
  alternateLabel: string;
  title: string;
  description: string;
  hero: {
    tagline: string;
    linksLabel: string;
  };
  run: {
    caption: string;
  };
  why: {
    eyebrow: string;
    paragraphs: [string, string];
    conclusion: {
      strong: string;
      rest?: string;
    };
  };
  flow: {
    eyebrow: string;
    ariaLabel: string;
    agent: string;
    asksQuestion: string;
    models: [string, string, string];
    writesConclusion: string;
    judge: string;
    comparesFindings: string;
    answer: string;
    answerDescription: string;
    runId: [string, string];
    followUp: [string, string];
    summary: string;
  };
  install: {
    eyebrow: string;
    copy: {
      buttonLabel: string;
      copiedLabel: string;
    };
    steps: {
      install: {
        title: string;
        skillsIntro: string;
        skillsNote: string;
        piIntro: string;
      };
      connect: {
        title: string;
        envIntro: string;
        envMore: string;
        envDocs: string;
        envKeys: string[];
        personalNote: [string, string, string];
        subscriptionSummary: string;
        subscriptionIntro: [string, string, string];
        login: [string, string];
      };
      configure: {
        title: string;
        beforeLevels: string;
        afterPath: string;
        levels: string;
      };
      ask: {
        title: string;
        stdout: string;
        piIntro: string;
        toolConnector: string;
        workflowConnector: string;
        ending: string;
      };
    };
  };
  footer: string;
};

export const content: Record<Locale, SiteContent> = {
  en: {
    locale: "en",
    lang: "en",
    ogLocale: "en_US",
    path: "/",
    alternatePath: "/ru/",
    alternateLabel: "RU",
    title: "Rejudge — Independent Review for AI Agents",
    description: "Several models review a question independently. A judge compares their conclusions, resolves disagreements, and returns one answer.",
    hero: {
      tagline: "Several models review the same question independently, and a judge compares their conclusions before your agent acts.",
      linksLabel: "Project links",
    },
    run: {
      caption: "A real Rejudge run: reviewers inspect the same question independently, then the judge returns one answer.",
    },
    why: {
      eyebrow: "Why",
      paragraphs: [
        "An agent cannot reliably review its own work. It uses the same assumptions that produced the answer, so it may miss the same error twice.",
        "A second model adds another answer, but does not resolve a disagreement. You still need a way to compare the conclusions and decide which one holds up.",
      ],
      conclusion: {
        strong: "Rejudge asks several models for separate conclusions, compares them, and returns one reviewed answer.",
      },
    },
    flow: {
      eyebrow: "How it works",
      ariaLabel: "Rejudge sends one question to separate models, then a judge compares their conclusions and returns one answer.",
      agent: "Your agent",
      asksQuestion: "asks a question",
      models: ["Model X", "Model Y", "Model Z"],
      writesConclusion: "writes its conclusion",
      judge: "Judge",
      comparesFindings: "compares the findings",
      answer: "Answer",
      answerDescription: "based on all findings",
      runId: ["+ Run ID", "to resume"],
      followUp: ["asks follow-up questions", "when the reviewers disagree"],
      summary: "Every reviewer gets the same request and works without seeing the others. The judge compares their answers and goes back with follow-up questions when they disagree. Rejudge prints a Run ID after the review; use --resume <run-id> to continue the saved review.",
    },
    install: {
      eyebrow: "Quick start",
      copy: {
        buttonLabel: "Copy",
        copiedLabel: "✓ Copied",
      },
      steps: {
        install: {
          title: "Install Rejudge",
          skillsIntro: "To connect Rejudge to a compatible coding agent outside Pi, install its Agent Skills with the",
          skillsNote: "This path does not require Pi.",
          piIntro: "Already use Pi? Connect this installation:",
        },
        connect: {
          title: "Provide model access",
          envIntro: "Rejudge uses Pi under the hood and reads its provider settings. You can use environment variables such as",
          envMore: "and more - read Pi",
          envDocs: "docs",
          envKeys: [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "OPENCODE_API_KEY",
          ],
          personalNote: [
            "I personally use",
            "OpenCode Go",
            "because it offers an excellent mix of models for $10 a month.",
          ],
          subscriptionSummary: "Using a subscription instead of API keys?",
          subscriptionIntro: [
            "Rejudge currently uses Pi for",
            "subscription",
            " login. If Pi is not already authorized, run:",
          ],
          login: ["Inside Pi, run", "and complete sign-in with your subscription provider."],
        },
        configure: {
          title: "Configure the panel",
          beforeLevels: "Create",
          afterPath: " once.",
          levels: "Use at least two reviewers. Every model needs a reasoning level; higher levels allow deeper analysis but take longer:",
        },
        ask: {
          title: "Ask",
          stdout: "The answer owns stdout; progress, configuration, and the run id go to stderr, so redirecting the answer keeps it clean.",
          piIntro: "Inside Pi the same package registers a native",
          toolConnector: "tool plus the",
          workflowConnector: "and",
          ending: "workflows.",
        },
      },
    },
    footer: "MIT licensed",
  },
  ru: {
    locale: "ru",
    lang: "ru",
    ogLocale: "ru_RU",
    path: "/ru/",
    alternatePath: "/",
    alternateLabel: "EN",
    title: "Rejudge — независимая проверка для ИИ-агентов",
    description: "Несколько моделей независимо разбирают вопрос. Судья сравнивает их выводы, разрешает разногласия и возвращает один ответ.",
    hero: {
      tagline: "Несколько моделей независимо разбирают один вопрос, а судья сравнивает их выводы до того, как ваш агент начнёт действовать.",
      linksLabel: "Ссылки проекта",
    },
    run: {
      caption: "Настоящий запуск Rejudge: несколько моделей независимо разбирают один вопрос, затем судья возвращает один ответ.",
    },
    why: {
      eyebrow: "Зачем",
      paragraphs: [
        "Агент не может надёжно проверить собственную работу. Он опирается на те же предположения, на которых построен ответ, поэтому может снова пропустить ту же ошибку.",
        "Вторая модель даёт ещё один ответ, но не разрешает разногласие. Выводы всё равно нужно сравнить и определить, какой выдерживает проверку.",
      ],
      conclusion: {
        strong: "Rejudge запрашивает отдельные выводы у нескольких моделей, сравнивает их и возвращает один ответ, прошедший проверку.",
      },
    },
    flow: {
      eyebrow: "Как это работает",
      ariaLabel: "Rejudge отправляет один вопрос нескольким моделям, затем судья сравнивает их выводы и возвращает один ответ.",
      agent: "Ваш агент",
      asksQuestion: "задаёт вопрос",
      models: ["Модель X", "Модель Y", "Модель Z"],
      writesConclusion: "пишет свой вывод",
      judge: "Судья",
      comparesFindings: "сравнивает выводы",
      answer: "Ответ",
      answerDescription: "с учётом всех выводов",
      runId: ["+ ID запуска", "для продолжения"],
      followUp: ["задаёт дополнительные вопросы", "когда выводы расходятся"],
      summary: "Каждая модель получает один и тот же вопрос и не видит чужих ответов. Судья сравнивает выводы и возвращается к моделям с дополнительными вопросами, если они расходятся. После проверки Rejudge выводит ID запуска. Команда --resume <run-id> продолжает сохранённую проверку.",
    },
    install: {
      eyebrow: "Быстрый старт",
      copy: {
        buttonLabel: "Копировать",
        copiedLabel: "✓ Скопировано",
      },
      steps: {
        install: {
          title: "Установите Rejudge",
          skillsIntro: "Чтобы подключить Rejudge к совместимому агенту вне Pi, установите Agent Skills через",
          skillsNote: "Для этого Pi не нужен.",
          piIntro: "Уже пользуетесь Pi? Подключите эту установку:",
        },
        connect: {
          title: "Предоставьте доступ к моделям",
          envIntro: "Rejudge работает через Pi и читает его настройки провайдеров. Например, можно использовать такие переменные окружения",
          envMore: "и другие - полный список в",
          envDocs: "документации Pi",
          envKeys: [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "OPENCODE_API_KEY",
          ],
          personalNote: [
            "Я сам пользуюсь",
            "OpenCode Go",
            "потому что за $10 в месяц он даёт отличный набор разных моделей.",
          ],
          subscriptionSummary: "Используете подписку вместо API-ключей?",
          subscriptionIntro: [
            "Для входа по",
            "подписке",
            " Rejudge пока использует Pi. Если Pi ещё не авторизован, запустите:",
          ],
          login: ["В Pi выполните", "и завершите вход у нужного провайдера подписки."],
        },
        configure: {
          title: "Настройте панель",
          beforeLevels: "Один раз создайте",
          afterPath: ".",
          levels: "Используйте минимум две проверяющие модели. Для каждой укажите уровень рассуждений: чем он выше, тем глубже анализ и дольше выполнение:",
        },
        ask: {
          title: "Задайте вопрос",
          stdout: "Ответ выводится в stdout. Прогресс, конфигурация и ID запуска идут в stderr, поэтому при перенаправлении в файле остаётся только ответ.",
          piIntro: "В Pi тот же пакет регистрирует встроенный инструмент",
          toolConnector: "вместе со сценариями",
          workflowConnector: "и",
          ending: "для агента.",
        },
      },
    },
    footer: "Лицензия MIT",
  },
};
