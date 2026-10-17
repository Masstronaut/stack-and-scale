<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Motion } from "motion-v";
import { onSlideEnter } from "@slidev/client";

const techs = [
  {
    name: "Box Storage",
    color: "#3b82f6",
    desc: "Customer document library — the source of truth.",
  },
  { name: "Box AI", color: "#38bdf8", desc: "Document intelligence across the library." },
  { name: "AWS Bedrock", color: "#a78bfa", desc: "Nova models draft grounded notes and decks." },
  { name: "Amazon SQS", color: "#fbbf24", desc: "One queue per worker · DLQ after 3 attempts." },
  { name: "Amazon SES", color: "#34d399", desc: "Renewal emails delivered to the AE." },
  { name: "Kiro coding agent", color: "#f472b6", desc: "Agentic, spec-driven development." },
];

const shown = ref(false);
let showTimer: ReturnType<typeof setTimeout> | undefined;

function play() {
  shown.value = false;
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => (shown.value = true), 30);
}

onMounted(play);
onSlideEnter(play);
onUnmounted(() => {
  if (showTimer) clearTimeout(showTimer);
});
</script>

<template>
  <div class="root">
    <div class="header">
      <Motion
        :initial="{ opacity: 0, y: -10 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
      >
        <h1>Powered by</h1>
        <p>Six services carry a renewal from raw documents to a sales-ready deck.</p>
      </Motion>
    </div>

    <div class="grid">
      <Motion
        v-for="(tech, i) in techs"
        :key="tech.name"
        class="card"
        :style="{ borderColor: `${tech.color}45` }"
        :initial="{ opacity: 0, y: 22, scale: 0.95 }"
        :animate="shown ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 22, scale: 0.95 }"
        :transition="{ delay: 0.15 + i * 0.09, type: 'spring', stiffness: 230, damping: 20 }"
      >
        <div class="row">
          <span
            class="dot"
            :style="{ background: tech.color, boxShadow: `0 0 10px ${tech.color}88` }"
          />
          <span class="name">{{ tech.name }}</span>
        </div>
        <p class="desc">{{ tech.desc }}</p>
      </Motion>
    </div>

    <div class="watermark mono">stack-and-scale · The Renewer</div>
  </div>
</template>

<style scoped>
.root {
  position: relative;
  width: 980px;
  height: 552px;
  overflow: hidden;
}

.header {
  position: absolute;
  top: 34px;
  left: 40px;
  right: 40px;
  text-align: center;
}
h1 {
  font-size: 26px;
  font-weight: 700;
  margin: 0;
}
.header p {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(226, 232, 240, 0.55);
}

.grid {
  position: absolute;
  top: 140px;
  left: 50px;
  right: 50px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.card {
  border-radius: 16px;
  border: 1px solid;
  background: rgba(148, 163, 184, 0.06);
  padding: 18px 20px;
  height: 150px;
  box-sizing: border-box;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex: none;
}
.name {
  font-size: 15.5px;
  font-weight: 650;
}
.desc {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(203, 213, 225, 0.75);
}

.watermark {
  position: absolute;
  left: 24px;
  bottom: 14px;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.3);
}
</style>
