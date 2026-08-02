# Casa — contas do mês

PWA para gerir despesas e receitas partilhadas. Calendário por dia, movimentos pontuais e mensais, relatório do mês. Sem dependências, sem build: são ficheiros estáticos.

## Estrutura

```
index.html              estrutura da página
styles.css              estilos
app.js                  toda a lógica
config.js               ← o único ficheiro que precisas de editar
manifest.webmanifest    metadados da PWA
sw.js                   service worker (funciona offline)
supabase.sql            esquema da base de dados
icons/                  ícones
```

## 1. Publicar no GitHub Pages

1. Cria um repositório novo no GitHub, por exemplo `casa`. Podes deixá-lo público: não há segredos aqui além da chave `anon` do Supabase, que é pública por design.
2. Envia todos estes ficheiros para a raiz do repositório (não para dentro de uma pasta).
3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, pasta `/ (root)`. Guarda.
4. Ao fim de um ou dois minutos fica disponível em `https://<utilizador>.github.io/casa/`.

Nesta fase já funciona, mas cada telemóvel tem os seus próprios dados.

## 2. Ligar a sincronização (Supabase)

1. Cria conta em supabase.com e um projeto novo. Região Frankfurt ou Paris.
2. **SQL Editor** → cola o conteúdo de `supabase.sql` → Run.
3. **Authentication → Users → Add user** → cria duas contas com email e palavra-passe (a tua e a da Bea). Marca a opção de confirmar o email automaticamente.
4. **Authentication → Sign In / Providers → Email**: desliga *Allow new users to sign up*. Sem isto, qualquer pessoa pode criar conta e ver as contas da casa.
5. **Project Settings → API**: copia o *Project URL* e a chave *anon public*.
6. Preenche `config.js` com esses dois valores, faz commit e envia.
7. Abre a app, toca em **entrar**, usa o email e a palavra-passe. A sessão fica guardada no aparelho.

## 3. Instalar no telemóvel

- **Android/Chrome**: abre o endereço → menu → *Adicionar ao ecrã principal*.
- **iPhone/Safari**: abre o endereço → botão partilhar → *Adicionar ao ecrã principal*. Tem de ser no Safari; no Chrome do iPhone não funciona.

## Como funciona a sincronização

Cada aparelho guarda uma cópia completa em `localStorage` e funciona offline. Quando há rede e sessão iniciada, a app lê o documento remoto, junta-o ao local e volta a escrever. A junção é por movimento: ganha sempre a versão editada mais tarde. Apagar não remove o registo, marca-o como apagado, para que a eliminação também se propague em vez de ser desfeita pela junção do outro aparelho.

Sincroniza ao abrir, ao voltar à app, ao recuperar a rede, meio segundo depois de cada alteração, e no botão *atualizar*.

## Manutenção

Sempre que alterares `app.js`, `styles.css` ou `index.html`, muda a linha `const CACHE = 'casa-v1'` em `sw.js` para `casa-v2`, `casa-v3`, etc. Sem isso o telemóvel continua a servir a versão em cache.

## Limitações conhecidas

- Não há histórico nem anulação: apagado é apagado.
- Se os dois editarem o mesmo movimento em simultâneo, fica a última edição.
- Sem categorias personalizáveis (estão no topo do `app.js`, na constante `CATS`).
- Sem exportação para folha de cálculo.
