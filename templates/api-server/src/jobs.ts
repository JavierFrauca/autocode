/**
 * Tareas programadas (sincronizaciones, limpiezas, envíos periódicos). Es lo propio de un servicio de
 * integración. Aquí va un ejemplo con `setInterval`; el agente lo reemplaza por las tareas reales (p.ej.
 * "cada noche, traer pedidos del ERP"). Para horarios concretos (cron) usa una librería como `node-cron`.
 *
 * Buenas prácticas: cada ejecución debe ser idempotente y atrapar sus propios errores (un fallo de un
 * ciclo no debe tumbar el proceso ni parar los siguientes).
 */
export function startJobs(): void {
  const UNA_HORA = 60 * 60 * 1000;
  setInterval(() => {
    tareaProgramadaEjemplo().catch((e) => console.error("[job] fallo en la tarea programada:", e));
  }, UNA_HORA);
}

async function tareaProgramadaEjemplo(): Promise<void> {
  // El agente sustituye esto por la sincronización/limpieza real del dominio.
  console.error(`[job] tarea programada ejecutada @ ${new Date().toISOString()}`);
}
