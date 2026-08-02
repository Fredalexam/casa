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
  SUPABASE_URL: 'https://ustxidxytguvigtnvqco.supabase.co/rest/v1',              // ex.: https://abcdefghijkl.supabase.co
  SUPABASE_ANON_KEY: '',         // chave legada "anon public"  (eyJ...)
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxx',  // ou chave nova "publishable" (sb_publishable_...)
  DOC_ID: 'casa'                 // identificador do livro de contas partilhado
};
