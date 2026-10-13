-- REAL (float4) do esquema inicial vira DOUBLE PRECISION (float8): o SQLite guardava REAL em 8 bytes, e horas/HH
-- calculados pela API precisam do mesmo valor ao ler de volta (ex.: 0,1 h não pode voltar como 0,10000000149).
-- O arquivo 20261013000000_initial_schema.sql permanece intocado; esta migração só altera os tipos.

BEGIN;

ALTER TABLE ordens
  ALTER COLUMN hh_previsto TYPE DOUBLE PRECISION USING hh_previsto::numeric::double precision;

ALTER TABLE apontamentos
  ALTER COLUMN hh_apropriado TYPE DOUBLE PRECISION USING hh_apropriado::numeric::double precision;

ALTER TABLE relatorios_execucao
  ALTER COLUMN indisponibilidade_horas TYPE DOUBLE PRECISION USING indisponibilidade_horas::numeric::double precision,
  ALTER COLUMN tempo_reparo_horas TYPE DOUBLE PRECISION USING tempo_reparo_horas::numeric::double precision;

ALTER TABLE execucoes_om
  ALTER COLUMN duracao_horas TYPE DOUBLE PRECISION USING duracao_horas::numeric::double precision,
  ALTER COLUMN hh_calculado TYPE DOUBLE PRECISION USING hh_calculado::numeric::double precision;

ALTER TABLE hh_disponivel
  ALTER COLUMN hh_disponivel TYPE DOUBLE PRECISION USING hh_disponivel::numeric::double precision;

ALTER TABLE ocorrencias_hh
  ALTER COLUMN horas_dia TYPE DOUBLE PRECISION USING horas_dia::numeric::double precision;

ALTER TABLE programacao_atividades
  ALTER COLUMN hh_previsto TYPE DOUBLE PRECISION USING hh_previsto::numeric::double precision;

ALTER TABLE sinalizacoes_ia
  ALTER COLUMN valor_atual TYPE DOUBLE PRECISION USING valor_atual::numeric::double precision,
  ALTER COLUMN valor_sugerido TYPE DOUBLE PRECISION USING valor_sugerido::numeric::double precision,
  ALTER COLUMN score TYPE DOUBLE PRECISION USING score::numeric::double precision,
  ALTER COLUMN valor_aplicado TYPE DOUBLE PRECISION USING valor_aplicado::numeric::double precision;

ALTER TABLE parametros_kpi
  ALTER COLUMN valor TYPE DOUBLE PRECISION USING valor::numeric::double precision;

COMMIT;
