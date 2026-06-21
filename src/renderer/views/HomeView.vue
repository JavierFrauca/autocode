<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAppStore } from "../stores";
import {
  Brain, FileText, Code2, Shield, Zap, Globe,
  MessageCircle, Sparkles, Rocket, ArrowRight, Lock,
} from "lucide-vue-next";
import logoLight from "../assets/logo-light.png";
import logoDark  from "../assets/logo-dark.png";

const router = useRouter();
const app    = useAppStore();
</script>

<template>
  <div class="home-shell">

    <!-- ── Hero ─────────────────────────────────────────────── -->
    <section class="hero">
      <img
        :src="app.theme === 'dark' ? logoDark : logoLight"
        class="hero-logo"
        alt="AutoCode"
      />

      <div class="hero-badge">
        <Lock :size="11" :stroke-width="2.5" />
        IA privada &nbsp;·&nbsp; Sin código &nbsp;·&nbsp; 100% local
      </div>

      <h1 class="hero-title">
        Crea aplicaciones reales<br>
        <span class="hero-gradient">sin escribir una línea de código</span>
      </h1>

      <p class="hero-sub">
        Describe tu negocio en español. AutoCode conversa contigo, documenta tu proyecto
        y genera una aplicación funcional completa — usando tu propia IA, sin enviar datos a Internet.
      </p>

      <div class="hero-actions">
        <button class="btn primary hero-btn" @click="router.push('/projects')">
          <Rocket :size="16" :stroke-width="2" />
          Abrir mis proyectos
          <ArrowRight :size="15" :stroke-width="2.5" />
        </button>
      </div>
    </section>

    <!-- ── Características ────────────────────────────────────── -->
    <section class="home-section">
      <div class="section-label">Capacidades</div>
      <div class="feat-grid">
        <div class="feat-card">
          <Brain :size="26" :stroke-width="1.5" class="feat-icon accent" />
          <strong class="feat-title">Lenguaje natural</strong>
          <p class="feat-desc">Habla en español. La IA entiende tu negocio y hace las preguntas correctas para no perderse nada.</p>
        </div>
        <div class="feat-card">
          <FileText :size="26" :stroke-width="1.5" class="feat-icon accent" />
          <strong class="feat-title">Documentación automática</strong>
          <p class="feat-desc">Crea y mantiene pantallas, flujos y reglas de negocio mientras conversas. Tú revisas, ella actualiza.</p>
        </div>
        <div class="feat-card">
          <Code2 :size="26" :stroke-width="1.5" class="feat-icon accent" />
          <strong class="feat-title">Código real</strong>
          <p class="feat-desc">Aplicaciones completas y funcionales, no prototipos. Frontend, backend y base de datos en un solo clic.</p>
        </div>
        <div class="feat-card">
          <Shield :size="26" :stroke-width="1.5" class="feat-icon green" />
          <strong class="feat-title">100% privado</strong>
          <p class="feat-desc">Funciona con Ollama o LiteLLM en tu red local. Ningún dato de tu empresa sale al exterior.</p>
        </div>
        <div class="feat-card">
          <Zap :size="26" :stroke-width="1.5" class="feat-icon amber" />
          <strong class="feat-title">Iteración instantánea</strong>
          <p class="feat-desc">Dile qué cambiar. AutoCode corrige, regenera y actualiza solo la parte que necesitas — en segundos.</p>
        </div>
        <div class="feat-card">
          <Globe :size="26" :stroke-width="1.5" class="feat-icon green" />
          <strong class="feat-title">Listo para desplegar</strong>
          <p class="feat-desc">El código generado incluye todo lo necesario para instalarlo en tu servidor con un solo comando.</p>
        </div>
      </div>
    </section>

    <!-- ── Cómo funciona ──────────────────────────────────────── -->
    <section class="home-section">
      <div class="section-label">Cómo funciona</div>
      <div class="hiw-row">
        <div class="hiw-card">
          <div class="hiw-num">01</div>
          <div class="hiw-icon-wrap">
            <MessageCircle :size="34" :stroke-width="1.4" />
          </div>
          <h3 class="hiw-title">Conversa</h3>
          <p class="hiw-desc">Cuéntale a AutoCode qué quieres construir. Ella pregunta, profundiza y captura cada detalle de tu negocio.</p>
        </div>

        <div class="hiw-arrow"><ArrowRight :size="22" :stroke-width="1.8" /></div>

        <div class="hiw-card">
          <div class="hiw-num">02</div>
          <div class="hiw-icon-wrap">
            <FileText :size="34" :stroke-width="1.4" />
          </div>
          <h3 class="hiw-title">Documenta</h3>
          <p class="hiw-desc">AutoCode genera automáticamente los documentos del proyecto: pantallas, flujos, entidades y reglas de negocio.</p>
        </div>

        <div class="hiw-arrow"><ArrowRight :size="22" :stroke-width="1.8" /></div>

        <div class="hiw-card">
          <div class="hiw-num">03</div>
          <div class="hiw-icon-wrap">
            <Sparkles :size="34" :stroke-width="1.4" />
          </div>
          <h3 class="hiw-title">Genera</h3>
          <p class="hiw-desc">Un clic convierte toda la documentación en una aplicación real, lista para instalar en tu servidor.</p>
        </div>
      </div>
    </section>

    <!-- ── Stack tecnológico ───────────────────────────────────── -->
    <section class="home-section stack-section">
      <div class="section-label">Stack tecnológico</div>
      <div class="stack-groups">
        <div class="stack-row">
          <span class="stack-group-name">IA local</span>
          <div class="stack-chips">
            <span class="chip chip-ia">Ollama</span>
            <span class="chip chip-ia">LiteLLM</span>
            <span class="chip chip-ia">Qdrant</span>
          </div>
        </div>
        <div class="stack-row">
          <span class="stack-group-name">Interfaz</span>
          <div class="stack-chips">
            <span class="chip chip-ui">Vue 3</span>
            <span class="chip chip-ui">TypeScript</span>
            <span class="chip chip-ui">Electron</span>
            <span class="chip chip-ui">Vite</span>
          </div>
        </div>
        <div class="stack-row">
          <span class="stack-group-name">Servidor</span>
          <div class="stack-chips">
            <span class="chip chip-srv">Node.js</span>
            <span class="chip chip-srv">Express</span>
            <span class="chip chip-srv">SQLite</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── CTA final ──────────────────────────────────────────── -->
    <section class="home-section cta-section">
      <h2 class="cta-title">¿Listo para crear tu primera app?</h2>
      <p class="cta-sub">Crea un proyecto, describe tu idea y deja que la IA haga el trabajo pesado.</p>
      <button class="btn primary cta-btn" @click="router.push('/projects')">
        <Rocket :size="17" :stroke-width="2" />
        Crear mi primer proyecto →
      </button>
    </section>

  </div>
</template>

<style scoped>
/* ── Shell ── */
.home-shell {
  flex: 1;
  overflow-y: auto;
  background: var(--bg);
}

/* ── Hero ── */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 32px 52px;
  border-bottom: 1px solid var(--border-dim);
  position: relative;
}

.hero-logo {
  height: 200px;
  width: auto;
  margin-bottom: 16px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  border-radius: 20px;
  padding: 5px 14px;
  margin-bottom: 22px;
}

.hero-title {
  font-size: 32px;
  font-weight: 800;
  line-height: 1.25;
  color: var(--text);
  margin-bottom: 16px;
  max-width: 640px;
  letter-spacing: -.5px;
}

.hero-gradient {
  background: linear-gradient(120deg, var(--accent) 0%, #A855F7 60%, #EC4899 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-sub {
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.7;
  max-width: 520px;
  margin-bottom: 28px;
}

.hero-actions { display: flex; gap: 12px; align-items: center; }
.hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  padding: 12px 26px;
}

/* ── Secciones generales ── */
.home-section {
  padding: 40px 40px;
  border-bottom: 1px solid var(--border-dim);
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--text-dim);
  margin-bottom: 22px;
}

/* ── Feature grid ── */
.feat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.feat-card {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color .15s, box-shadow .15s, transform .15s;
  box-shadow: var(--shadow-sm);
}
.feat-card:hover {
  border-color: var(--accent-border);
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.feat-icon { flex-shrink: 0; }
.feat-icon.accent { color: var(--accent); }
.feat-icon.green  { color: var(--green); }
.feat-icon.amber  { color: var(--yellow); }

.feat-title { font-size: 13px; font-weight: 700; color: var(--text); }
.feat-desc  { font-size: 12px; color: var(--text-muted); line-height: 1.6; }

/* ── Cómo funciona ── */
.hiw-row {
  display: grid;
  grid-template-columns: 1fr 36px 1fr 36px 1fr;
  align-items: start;
  gap: 8px;
}

.hiw-card {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 22px 18px;
  text-align: center;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.hiw-num {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--accent);
  font-family: var(--font-mono);
}

.hiw-icon-wrap {
  width: 60px; height: 60px;
  border-radius: 50%;
  background: var(--accent-bg);
  border: 1.5px solid var(--accent-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.hiw-title { font-size: 15px; font-weight: 700; color: var(--text); }
.hiw-desc  { font-size: 12px; color: var(--text-muted); line-height: 1.6; }

.hiw-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  padding-top: 60px;
}

/* ── Stack ── */
.stack-groups { display: flex; flex-direction: column; gap: 14px; }
.stack-row    { display: flex; align-items: center; gap: 16px; }
.stack-group-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: .07em;
  width: 60px;
  flex-shrink: 0;
}
.stack-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.chip {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 13px;
  border-radius: 20px;
  border: 1.5px solid transparent;
}
.chip-ia  { background: var(--accent-bg);  border-color: var(--accent-border);  color: var(--accent); }
.chip-ui  { background: var(--green-bg);   border-color: var(--green-border);   color: var(--green);  }
.chip-srv { background: var(--yellow-bg);  border-color: var(--yellow-border);  color: var(--yellow); }

/* ── CTA ── */
.cta-section {
  text-align: center;
  border-bottom: none;
  padding-bottom: 64px;
}
.cta-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 10px;
  letter-spacing: -.3px;
}
.cta-sub  { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
.cta-btn  { display: inline-flex; align-items: center; gap: 9px; font-size: 15px; padding: 13px 30px; }
</style>
