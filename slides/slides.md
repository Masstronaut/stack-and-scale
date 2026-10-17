---
theme: default
colorSchema: dark
fonts: false
transition: slide-left
title: "The Renewer — pipeline tour"
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

---

<ProblemSlide />

---

<DocsIntoBox />

---

<PipelineFlow />

---

<TechGrid />
