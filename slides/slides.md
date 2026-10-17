---
theme: default
colorSchema: dark
fonts: false
transition: slide-left
title: "The Renewer — pipeline tour"
---

# Cover

---
layout: cover
class: renewer-cover
---

<div
  class="cover-eyebrow"
  v-motion
  :initial="{ opacity: 0, y: 18 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.5 } }"
>
  STACK-AND-SCALE · SST · SQS · LAMBDA · BOX
</div>

<h1
  class="cover-title"
  v-motion
  :initial="{ opacity: 0, y: 26 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.3, duration: 0.55 } }"
>
  The Renewer
</h1>

<p
  class="cover-sub"
  v-motion
  :initial="{ opacity: 0, y: 22 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.5, duration: 0.5 } }"
>
  Documents in. Sales pitch out.
</p>

<p
  class="cover-authors"
  v-motion
  :initial="{ opacity: 0, y: 14 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.65, duration: 0.5 } }"
>
  by Allan Deutsch, Justin Oliver Lee, and Ruslan Makhlouf
</p>

<p
  class="cover-sub2"
  v-motion
  :initial="{ opacity: 0 }"
  :enter="{ opacity: 1, transition: { delay: 0.8, duration: 0.5 } }"
>
  An animated tour of the four-worker document pipeline.
</p>

<div
  class="cover-chips"
  v-motion
  :initial="{ opacity: 0, y: 14 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.95, duration: 0.5 } }"
>
  <span>Box ingest</span>
  <span>SQS × 4</span>
  <span>Lambda workers</span>
  <span>DLQ per stage</span>
</div>

# The problem

---
layout: full
class: problem-slide
---

<div class="problem-eyebrow"
  v-motion
  :initial="{ opacity: 0, y: -8 }"
  :enter="{ opacity: 1, y: 0, transition: { delay: 0.1, duration: 0.45 } }"
>
  The problem
</div>

<div class="problem-stack">
  <p
    class="line-1"
    v-motion
    :initial="{ opacity: 0, y: 24 }"
    :enter="{ opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.55 } }"
  >
    Contract expirations can cost <b>millions</b>.
  </p>

  <p
    class="line-2"
    v-motion
    :initial="{ opacity: 0, y: 22 }"
    :enter="{ opacity: 1, y: 0, transition: { delay: 0.6, duration: 0.55 } }"
  >
    Churn is <b>expensive</b>.
  </p>

  <p
    class="line-3"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { delay: 0.9, duration: 0.6 } }"
  >
    The evidence that saves a renewal sits scattered across thousands of
    documents — and nobody reads them all in time.
  </p>

  <p
    class="line-4"
    v-motion
    :initial="{ opacity: 0, y: 12 }"
    :enter="{ opacity: 1, y: 0, transition: { delay: 1.2, duration: 0.55 } }"
  >
    The Renewer reads them first — and writes the pitch.
  </p>
</div>

# Docs into Box

---
layout: full
---

<DocsIntoBox />

# The pipeline

---
layout: full
---

<PipelineFlow />

# Powered by

---
layout: full
---

<TechGrid />
