# QNT CUP BROADCAST V4.6 — Vercel + Supabase

## O que foi mantido e o que mudou
A interface original (HTML, CSS e JavaScript de apresentação) foi preservada. O servidor local Python foi substituído por uma API Node na Vercel. Estado compartilhado e uploads novos passam a ficar no Supabase. Os arquivos são enviados diretamente ao Storage por URLs temporárias assinadas, evitando o limite de corpo das funções Vercel. O backup ZIP é guardado temporariamente em um bucket privado e baixado por link assinado. Os overlays continuam públicos para o OBS; o painel exige senha administrativa.

## Etapa 1 — Criar o projeto Supabase
1. Crie um projeto em https://supabase.com/.
2. Abra SQL Editor e execute todo o conteúdo de `SUPABASE_SETUP.sql`.
3. Em Project Settings → API, copie a Project URL e a chave `service_role`/secret. Essa chave é confidencial: não a coloque no navegador, em arquivos públicos ou no GitHub.

## Etapa 2 — Migrar a configuração atual e as imagens
Recomendado para manter os times, logos e configurações atuais:
1. Tenha Python 3 instalado no computador.
2. Abra um terminal dentro desta pasta do projeto.
3. Defina temporariamente as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no terminal.
   - Windows PowerShell: `$env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"` e `$env:SUPABASE_SERVICE_ROLE_KEY="SUA_CHAVE"`
   - macOS/Linux: `export SUPABASE_URL="https://SEU-PROJETO.supabase.co"` e `export SUPABASE_SERVICE_ROLE_KEY="SUA_CHAVE"`
4. Execute `python migrate_to_supabase.py`.
O script envia `data/state.json` e as imagens de `assets/uploads` ao Supabase. A cópia original do ZIP permanece intacta.

## Etapa 3 — Enviar ao GitHub
1. Crie um repositório privado no GitHub.
2. Extraia o ZIP adaptado e envie o conteúdo desta pasta, não o ZIP fechado.
3. Confira se `vercel.json`, `package.json`, `api/`, `assets/`, `data/` e os HTML estão na raiz do repositório.
4. Nunca envie a chave `service_role` nem um arquivo `.env`.

## Etapa 4 — Publicar na Vercel
1. Acesse https://vercel.com/ → Add New → Project e importe o repositório.
2. Framework Preset: Other. Root Directory: a pasta onde estão `vercel.json` e `package.json`.
3. Em Settings → Environment Variables, adicione:
   - `SUPABASE_URL` = Project URL do Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = chave secreta service_role
   - `QNT_ADMIN_PASSWORD` = senha forte compartilhada apenas com administradores
   - `QNT_SESSION_SECRET` = segredo aleatório longo (32 caracteres ou mais)
4. Faça Deploy.

## URLs depois do deploy
- Painel: `/controle`
- Overlay gameplay: `/overlay`
- Intervalo: `/intervalo`
- Veto: `/veto`
- Elencos: `/elencos`

No OBS, use as URLs HTTPS do domínio Vercel como fontes de navegador, em 1920×1080. Não marque “Arquivo local”.

## Uso pela equipe
Cada operador abre `/controle` e informa a senha compartilhada. Overlays são públicos e somente leitura. A tela de controle sincroniza alterações feitas por outros operadores em intervalos curtos.

## Limitações importantes
- O plano gratuito dos provedores tem limites de uso e pode pausar projetos inativos; confirme os limites atuais antes de uma transmissão importante.
- A sincronização do painel usa consulta periódica ao banco. Se duas pessoas editarem o mesmo campo simultaneamente, a última gravação pode prevalecer. Para a transmissão, definam um operador principal para placar e veto.
- A V4.6 original permanece no ZIP original; mantenha-o guardado como backup.
- O backup/restore inclui o estado e as imagens referenciadas. O arquivo de backup é armazenado temporariamente no bucket privado `qnt-backups`; o link de download expira após alguns minutos. Teste baixar e restaurar um backup antes do evento.
