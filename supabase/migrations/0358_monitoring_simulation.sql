-- Überwachung: Ausfall simulieren.
--
-- Solange simulate_until in der Zukunft liegt, wertet nextDesk die Messungen
-- dieses Sensors als fehlgeschlagen («Simulierter Ausfall (Test)»). Störung,
-- Alarmierung, Systemstatus und Veröffentlichung laufen wie bei einem echten
-- Ausfall. Die Simulation endet von selbst.

alter table public.monitoring_sensors
  add column if not exists simulate_until timestamptz;

comment on column public.monitoring_sensors.simulate_until is
  'Until then results of the sensor count as failed (test of the alerting chain). Null = no simulation.';
