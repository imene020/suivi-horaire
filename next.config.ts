import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------
//
// La CSP elle-même (avec son nonce par requête) est générée dans
// `src/proxy.ts` et posée comme en-tête de réponse à chaque requête : elle ne
// peut pas être statique ici, car Next.js (App Router) injecte des
// <script> inline (streaming des données RSC) qui nécessitent un nonce
// unique par requête pour rester autorisés sous une CSP stricte sans
// 'unsafe-inline'. Voir `src/proxy.ts` pour le détail des directives.
// ---------------------------------------------------------------------------

const securityHeaders = [
  // Empêche l'application d'être chargée dans une <iframe> tierce (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Empêche le navigateur de deviner un type MIME différent de celui déclaré.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Limite les informations envoyées dans l'en-tête Referer vers d'autres origines.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Désactive par défaut les API sensibles (caméra, micro, géoloc) non utilisées par l'app.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Force HTTPS pendant 2 ans une fois servi en HTTPS (sans effet en dev HTTP).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // La Content-Security-Policy (avec nonce) est posée dynamiquement dans src/proxy.ts.
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      // 1 Mo par défaut : trop peu pour une fiche de paie PDF ou une photo de feuille de
      // présence. 4,5 Mo = limite des requêtes sur Vercel (fichiers plafonnés à 4 Mo,
      // voir MAX_UPLOAD_BYTES dans src/lib/constants.ts).
      bodySizeLimit: "4.5mb",
      // *.vercel.app était trop large (n'importe quel projet Vercel pourrait
      // envoyer des requêtes Server Action). On le remplace par le seul hôte
      // de production réel. La variante générique est conservée en commentaire.
      allowedOrigins: [
        "localhost:3000",
        "127.0.0.1:3000",
        "192.168.178.129:3000",
        "127.0.0.1:53311",
        "localhost:53311",
        "suivi-horaire-oussama-mabrouks-projects.vercel.app",
        // "*.vercel.app", // trop large — remplacé par l'hôte exact ci-dessus
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
