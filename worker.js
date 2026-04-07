/**
 * ============================================================
 *  CGP Skool — Quiz Worker (Cloudflare Workers)
 * ============================================================
 *  Ce Worker reçoit les nouvelles questions depuis le site
 *  et les écrit dans questions.json sur GitHub.
 *  Le token GitHub est stocké côté serveur dans les
 *  variables d'environnement Cloudflare (jamais exposé).
 *
 *  Variables d'environnement à configurer dans Cloudflare :
 *    - GITHUB_USER     : adussourd-pp
 *    - GITHUB_REPO     : cgpskool_quiz_habilitation
 *    - GITHUB_BRANCH   : main
 *    - GITHUB_TOKEN    : votre PAT (encrypted secret)
 * ============================================================
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    // Pré-vol CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Healthcheck
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "cgp-skool-quiz" });
    }

    // POST /add — ajoute une ou plusieurs questions
    if (request.method === "POST" && url.pathname === "/add") {
      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON" }, 400);
      }
      const newQuestions = Array.isArray(payload.questions) ? payload.questions : [];
      if (newQuestions.length === 0) {
        return json({ error: "No questions provided" }, 400);
      }

      // Validation basique
      for (const q of newQuestions) {
        if (!q.question || !Array.isArray(q.propositions) || typeof q.bonne_reponse !== "number") {
          return json({ error: "Invalid question format", q }, 400);
        }
      }

      const apiBase = `https://api.github.com/repos/${env.GITHUB_USER}/${env.GITHUB_REPO}/contents/questions.json`;
      const ghHeaders = {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "cgp-skool-quiz-worker",
        Accept: "application/vnd.github+json",
      };

      // Récupérer le fichier actuel
      const getRes = await fetch(`${apiBase}?ref=${env.GITHUB_BRANCH}`, { headers: ghHeaders });
      if (!getRes.ok) {
        const t = await getRes.text();
        return json({ error: "GitHub GET failed", status: getRes.status, body: t }, 502);
      }
      const fileData = await getRes.json();
      const currentContent = atob(fileData.content.replace(/\n/g, ""));
      let questions;
      try {
        questions = JSON.parse(currentContent);
      } catch (e) {
        questions = [];
      }
      if (!Array.isArray(questions)) questions = [];

      // Ajouter les nouvelles questions
      questions.push(...newQuestions);

      // Réécrire le fichier
      const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(questions, null, 2) + "\n")));
      const putRes = await fetch(apiBase, {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Ajout de ${newQuestions.length} question(s) via le site`,
          content: newContent,
          sha: fileData.sha,
          branch: env.GITHUB_BRANCH,
        }),
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        return json({ error: "GitHub PUT failed", status: putRes.status, body: t }, 502);
      }

      return json({ ok: true, added: newQuestions.length, total: questions.length });
    }

    return json({ error: "Not found" }, 404);
  },
};
