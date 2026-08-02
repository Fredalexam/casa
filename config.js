/* -------------------------------------------------------------
   Configuração da app.

   SUPABASE_URL é a raiz do projeto: sem /rest/v1 e sem barra
   no fim. A app acrescenta os caminhos sozinha.

   A chave publishable é pública por design. A segurança vem das
   políticas RLS (supabase.sql) e de teres o registo de novos
   utilizadores desativado no painel do Supabase.
   ------------------------------------------------------------- */
window.CASA_CONFIG = {
  SUPABASE_URL: 'https://ustxidxytguvigtnvqco.supabase.co',
  SUPABASE_ANON_KEY: '',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TV8lXw6Wa8-ohQ0x8Cal7Q_-_al-6Jy',
  DOC_ID: 'casa',

  // Liga cada email ao nome que aparece nos lançamentos.
  USERS: {
    'aleandro200@gmail.com': 'Fred',
    'beatriz.morgado254@gmail.com': 'Bea'
  }
};
