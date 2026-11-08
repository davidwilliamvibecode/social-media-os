// Rotina diária de manutenção do Social Media OS.
//
// A limpeza de sessões inativas (`sessions.cleanupInactiveSessions`) roda uma
// vez por dia, de madrugada em UTC — o produto é single-seat e o uso típico é
// no fuso do Brasil (UTC-3), então 6h30 UTC cai fora do horário de trabalho.
// O Convex registra e executa o agendamento sozinho na implantação dev/prod;
// nada de infraestrutura extra é necessário.

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "cleanup-inactive-sessions",
  { hourUTC: 6, minuteUTC: 30 },
  internal.sessions.cleanupInactiveSessions,
  {},
);

// Descarta OAuth não concluídos e tokens de Página ainda não selecionados.
crons.hourly(
  "cleanup-expired-meta-oauth",
  { minuteUTC: 17 },
  internal.meta.cleanupExpiredConnections,
  {},
);

export default crons;
