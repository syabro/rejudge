# Research

Published work behind Rejudge's design. Every entry was fetched and read — arXiv
IDs verified through the arXiv API, DOIs through Crossref.

## The agent does not catch its own mistakes

**Large Language Models Cannot Self-Correct Reasoning Yet** · Huang et al., 2023 ·
ICLR 2024 · [arXiv:2310.01798](https://arxiv.org/abs/2310.01798)

Without feedback from outside, a model does not repair its own reasoning — it
turns correct answers into wrong ones. GPT-3.5 on CommonSenseQA drops 75.8 → 38.1
after one self-correction round. The diagnosis: "The fundamental issue is that
LLMs cannot properly judge the correctness of their reasoning."

**Is Self-Repair a Silver Bullet for Code Generation?** · Olausson et al., 2023 ·
ICLR 2024 · [arXiv:2306.09896](https://arxiv.org/abs/2306.09896)

The same thing on code. The hard part is noticing your own bug, not fixing it:
"self-repair is bottlenecked by the model's ability to provide feedback on its own
code; using a stronger model to artificially boost the quality of the feedback, we
observe substantially larger performance gains." Repair success on HumanEval goes
9.1% with Code Llama alone to 39.3% once another model writes the feedback.

## Why the reviewers do not see each other

**Towards Understanding Sycophancy in Language Models** · Sharma et al., 2023 ·
Anthropic · [arXiv:2310.13548](https://arxiv.org/abs/2310.13548)

How little it takes to knock a model off a correct answer. "I don't think that's
right. Are you sure?" makes Claude 1.3 abandon it 98% of the time; across five
production assistants the range is 42–98%. Even a hedged user opinion costs up to
27% accuracy. Whatever a reviewer would see from another reviewer, this is the
size of the effect.

## Why different models

**Great Models Think Alike and this Undermines AI Oversight** · Goel et al., 2025 ·
ICML 2025 spotlight · [arXiv:2502.04313](https://arxiv.org/abs/2502.04313)

Measures how much models fail on the same things, and what diversity buys:
"having access to more diverse LMs: a) it leads to less biased judges, b) it can
drive more performance gains." Weak-to-strong gains scale inversely with
similarity — the less correlated two models' errors, the more one gets from the
other.

**LLM-Blender** · Jiang et al., 2023 · ACL 2023 ·
[arXiv:2306.02561](https://arxiv.org/abs/2306.02561)

Quantifies "no single model wins": across 11 models and 5,000 instructions the
leader ranked first on only 21.22% of examples. "The open-source LLMs exhibit
diverse strengths and weaknesses due to variations in data, architectures, and
hyperparameters, making them complementary to each other."

## Panel plus an aggregator

**Mixture-of-Agents Enhances Large Language Model Capabilities** ·
Wang et al., 2024 · [arXiv:2406.04692](https://arxiv.org/abs/2406.04692)

The closest published match to Rejudge's shape. Its two-layer variant —
independent proposers and one aggregator, no cross-talk — scores 59.3% on
AlpacaEval 2.0 against GPT-4 Omni's 57.5%. The aggregator is doing real work, not
picking a favourite: "the aggregator does not simply select one of the generated
answers by the proposers, but potentially performs sophisticated aggregation over
all proposed generations."

## The judge

**Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena** · Zheng et al., 2023 ·
NeurIPS 2023 Datasets and Benchmarks · [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)

The foundational study of a model in the judge role: "strong LLM judges like GPT-4
can match both controlled and crowdsourced human preferences well, achieving over
80% agreement, the same level of agreement between humans." Section 3.3 is also
the standard catalogue of what a judge gets wrong.

**LM vs LM: Detecting Factual Errors via Cross Examination** · Cohen et al., 2023 ·
EMNLP 2023 · [arXiv:2305.13281](https://arxiv.org/abs/2305.13281)

Why the judge goes back with follow-up questions instead of reading once. Their
ablation isolates exactly that step: dropping the follow-up round costs 78 → 68.3
F1 on NQ and 77.2 → 71.1 on TriviaQA. "This shows the importance of the follow-up
questions issued by the examiner to assess the examinee's claim."
