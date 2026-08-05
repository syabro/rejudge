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
      tagline: "Independent review before your agent acts.",
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
      ariaLabel: "Your agent asks a question. Rejudge sends the same request to every reviewer at once, and each one writes its conclusion without seeing the other answers. The judge compares the findings and returns an answer with a run ID for resuming the review later.",
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
          login: ["Then run", "and complete sign-in with your subscription provider."],
        },
        configure: {
          title: "Configure the panel",
          beforeLevels: "Create",
          afterPath: " once.",
          levels: "Two reviewers minimum, and every model carries a reasoning level:",
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
      tagline: "Независимая проверка до того, как агент начнёт действовать.",
      linksLabel: "Ссылки проекта",
    },
    run: {
      caption: "Три модели независимо читают код. Судья ждёт их выводов, а затем отвечает.",
    },
    why: {
      eyebrow: "Зачем",
      paragraphs: [
        "Агент, который только что написал код, хуже всего подходит для его проверки. Он проверяет собственные рассуждения той же моделью, которая их построила, поэтому ошибка при написании переживает повторное чтение.",
        "Одна дополнительная модель помогает, пока сама не ошибается с полной уверенностью. Получается гладкое второе мнение, но его не с чем сопоставить и непонятно, какие части ответа вызывают спор.",
      ],
      conclusion: {
        strong: "Rejudge запускает несколько моделей, которые не видят работу друг друга, а затем заставляет одну из них разобраться с расхождениями.",
        rest: "В результате возвращается либо согласованный вывод, которому можно доверять, либо разногласие, которое стоит прочитать.",
      },
    },
    flow: {
      eyebrow: "Как это работает",
      ariaLabel: "Агент задаёт вопрос. Rejudge одновременно отправляет его трём моделям. Каждая модель пишет свой вывод и не видит остальные ответы. Судья сравнивает выводы и возвращает ответ с ID запуска, по которому проверку можно продолжить позже.",
      agent: "Ваш агент",
      asksQuestion: "задаёт вопрос",
      models: ["Модель X", "Модель Y", "Модель Z"],
      writesConclusion: "пишет свой вывод",
      judge: "Судья",
      comparesFindings: "сравнивает выводы",
      answer: "Ответ",
      answerDescription: "с учётом выводов",
      runId: ["+ ID запуска", "для продолжения"],
      followUp: ["задаёт дополнительные вопросы", "когда выводы расходятся"],
      summary: "Каждая модель получает один и тот же вопрос и работает, не видя остальных. Судья сравнивает ответы и возвращается к моделям с дополнительными вопросами, если они расходятся.",
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
          piIntro: "Pi уже установлен? Подключите эту установку:",
        },
        connect: {
          title: "Предоставьте доступ к моделям",
          envIntro: "Rejudge использует Pi под капотом и читает его настройки провайдеров. Можно использовать, например, такие переменные окружения",
          envMore: "и другие — читайте",
          envDocs: "документацию Pi",
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
            "Пока Rejudge использует Pi для входа по",
            "подписке",
            ". Если Pi ещё не авторизован, выполните:",
          ],
          login: ["Затем выполните", "и завершите авторизацию у нужного провайдера подписки."],
        },
        configure: {
          title: "Настройте панель",
          beforeLevels: "Один раз создайте",
          afterPath: ".",
          levels: "Требуются минимум две проверяющие модели. Для каждой указывается уровень рассуждения:",
        },
        ask: {
          title: "Задайте вопрос",
          stdout: "Готовый ответ идёт в stdout. Прогресс, конфигурация и ID запуска идут в stderr, поэтому перенаправление сохраняет ответ чистым.",
          piIntro: "В Pi тот же пакет регистрирует встроенный",
          toolConnector: "инструмент и сценарии",
          workflowConnector: "и",
          ending: ".",
        },
      },
    },
    footer: "Лицензия MIT",
  },
};
