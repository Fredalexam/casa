/* -------------------------------------------------------------
   Configuração da app.

   Deixa os dois campos vazios para funcionar apenas neste
   aparelho (modo local, sem sincronização).

   Para sincronizar entre telemóveis, preenche com os dados do
   teu projeto Supabase. A chave pública é pública por design:
   é seguro tê-la aqui desde que (a) as políticas RLS exijam
   utilizador autenticado, que é o que o supabase.sql faz, e
   (b) o registo público esteja desativado no painel.

   Conforme a idade do projeto, a chave pública chama-se
   "anon public" (começa por eyJ...) ou "publishable"
   (começa por sb_publishable_...). Qualquer uma serve: cola-a
   no campo correspondente e deixa o outro vazio.
   ------------------------------------------------------------- */
window.CASA_CONFIG = {
  SUPABASE_URL: 'https://ustxidxytguvigtnvqco.supabase.co',
  SUPABASE_ANON_KEY: '',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TV8lXw6Wa8-ohQ0x8Cal7Q_-_al-6Jy',
  DOC_ID: 'casa',
  USERS: {
    'aleandro200@gmail.com': 'Fred',
    'beatriz.morgado254@gmail.com': 'Bea'
};
