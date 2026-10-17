<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Motion } from 'motion-v'
import { onSlideEnter } from '@slidev/client'

const shown = ref(false)
let showTimer: ReturnType<typeof setTimeout> | undefined

function play() {
  shown.value = false
  if (showTimer) clearTimeout(showTimer)
  showTimer = setTimeout(() => (shown.value = true), 30)
}

onMounted(play)
onSlideEnter(play)
onUnmounted(() => {
  if (showTimer) clearTimeout(showTimer)
})
</script>

<template>
  <div class="problem-slide">
    <div class="deco deco-amber" />

    <Motion
      class="problem-eyebrow"
      :initial="{ opacity: 0, y: -8 }"
      :animate="shown ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }"
      :transition="{ delay: 0.1, duration: 0.45 }"
    >
      The problem
    </Motion>

    <div class="problem-stack">
      <Motion
        as="p"
        class="line-1"
        :initial="{ opacity: 0, y: 24 }"
        :animate="shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }"
        :transition="{ delay: 0.35, duration: 0.55 }"
      >
        Contract expirations can cost <b>millions</b>.
      </Motion>

      <Motion
        as="p"
        class="line-2"
        :initial="{ opacity: 0, y: 22 }"
        :animate="shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }"
        :transition="{ delay: 0.6, duration: 0.55 }"
      >
        Churn is <b>expensive</b>.
      </Motion>

      <Motion
        as="p"
        class="line-3"
        :initial="{ opacity: 0 }"
        :animate="shown ? { opacity: 1 } : { opacity: 0 }"
        :transition="{ delay: 0.9, duration: 0.6 }"
      >
        The evidence that saves a renewal sits scattered across thousands of
        documents — and nobody reads them all in time.
      </Motion>

      <Motion
        as="p"
        class="line-4"
        :initial="{ opacity: 0, y: 12 }"
        :animate="shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }"
        :transition="{ delay: 1.2, duration: 0.55 }"
      >
        The Renewer reads them first — and writes the pitch.
      </Motion>
    </div>
  </div>
</template>

<style scoped>
.deco-amber {
  position: absolute;
  width: 420px;
  height: 420px;
  left: -140px;
  bottom: -180px;
  border-radius: 9999px;
  background: rgba(245, 158, 11, 0.09);
  filter: blur(70px);
  pointer-events: none;
}
</style>
