# Visitas e Despesas

App para o supervisor e os colaboradores lançarem **visitas e despesas**.

- **Colaborador:** lança e vê **somente os seus** lançamentos.
- **Supervisor (Eliezer):** lança os dele e **visualiza todos** (filtro por pessoa, período e loja, totais e CSV). Não altera o que os outros lançaram.
- Custos do acompanhante têm colunas próprias (não vão mais em "Outros").
- KM validado: chegada ≥ saída, máximo 1.000 km/dia, máximo 999.999, e aviso se a saída não bate com a última chegada do mesmo veículo.

Isto é independente da planilha e da rotina de domingo: nada nelas foi alterado.

## Como colocar no ar

### 1. Banco e login (Supabase, plano gratuito)
1. Crie um projeto em supabase.com.
2. **SQL Editor → New query**: cole todo o `supabase/schema.sql` e clique **Run**.
3. **Authentication → Users → Add user**: crie um usuário (e-mail + senha, marque "Auto Confirm User") para o Eliezer e outro para cada colaborador.
4. No SQL Editor, torne o Eliezer supervisor (troque o e-mail):
   ```sql
   update public.profiles set role = 'supervisor', nome = 'Eliezer'
   where id = (select id from auth.users where email = 'EMAIL_DO_ELIEZER');
   ```
   Ajuste o nome de cada colaborador do mesmo jeito (`nome = '...'`).
5. **Authentication → Providers → Email**: desligue "Allow new users to sign up" (cadastro livre) para só entrar quem você criou.
6. **Project Settings → API**: copie a **Project URL** e a **anon public key** para o `config.js`.

### 2. Publicar (GitHub Pages)
1. Suba estes arquivos na raiz do repositório.
2. **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**.
3. O endereço sai como `https://takaara-uniao.github.io/visita_repositores/`.
4. No celular: abra o endereço e use "Adicionar à tela inicial".

A `anon key` é pública por desenho. Quem protege os dados são as regras (RLS) do `schema.sql`.

## Segunda etapa (não feita)
Foto obrigatória da nota e do hodômetro, e mais colaboradores do frete.
