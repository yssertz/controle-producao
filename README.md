# Controle Geral de Produção (CGP)

Sistema interno para controle da produção: listas, OPs/peças, colagem do ERP/Excel, catálogo item→linha, **nestings de corte (laser/bobina)**, acompanhamento Leniors e dashboard.
Stack: Next.js (App Router) · TypeScript · React · Supabase (PostgreSQL + Auth) · Lucide.

> **Status honesto:** o código foi revisado nesta entrega, o erro JSX do detalhe do nesting foi corrigido e os 22 testes automatizados passaram. A instalação das dependências não concluiu neste ambiente; por isso, `npm run typecheck`, `npm run lint`, `npm run build` e a execução das migrations em um Supabase real ainda precisam ser validados localmente. Os percentuais por linha da planilha de controle (imagem "05/03/2026") **ainda não existem**.

## Pré-requisitos (Windows)
- Node.js 22 LTS (para `npm test` é preciso 22.18+; para rodar o sistema, 20.9+ basta) e VS Code.
- Um projeto Supabase (gratuito serve).

## 1. Configurar o Supabase (instalação limpa pelo CLI)

> **Use um projeto Supabase novo/vazio para a primeira instalação.** As migrations são versionadas e devem ser aplicadas pelo CLI; não cole os arquivos manualmente no SQL Editor. Não execute `db push` em um banco que já recebeu essas tabelas/views manualmente sem antes reconciliar o histórico.

1. Crie um projeto em supabase.com e copie o **Project Reference ID**.
2. No terminal, na pasta raiz deste projeto, execute:
   ```powershell
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase migration list
   npx supabase db push
   ```
3. Confirme que `npx supabase migration list` mostra todas as migrations locais como aplicadas no remoto. A sequência deste repositório é `0001` a `0008`, `0010` e `0011` (não existe `0009`).
4. A migration `0007` cria as versões definitivas das views de consulta. A `0005` cria a função do dashboard, mas deixa as views para a `0007`, evitando criar e depois substituir estruturas intermediárias.
5. **Catálogo de itens:** depois de entrar no sistema, abra **Catálogo de itens** e importe `supabase/seed/catalogo_itens.tsv` (15.840 itens da aba MAQUINA da planilha Roll-On). Sem o catálogo, a colagem não descobre a linha dos itens.
6. **Auth → Sign In / Providers**: desligue *Allow new users to sign up* (o sistema não tem cadastro público).
7. **Auth → Users → Add user**: crie seu usuário (e-mail + senha, marque *Auto Confirm*).

### Importante sobre migrations já executadas manualmente

O `supabase migration list` compara os arquivos locais com o histórico remoto. Se você executou SQL manualmente no painel, o banco pode conter tabelas e views, mas o histórico remoto continuará vazio. **Não rode `db push` nem `migration repair` às cegas.** Para uma instalação realmente limpa, crie um projeto Supabase novo e aplique tudo com `db push`. Se precisar manter o projeto atual, faça backup e reconcilie cada migration antes de sincronizar o histórico.

### Criar o primeiro administrador
Todo usuário novo nasce **sem acesso**. No SQL Editor, libere o seu:
```sql
update public.user_profiles set role = 'admin', active = true where email = 'SEU-EMAIL@exemplo.com';
```
Para os demais usuários use `role` = `pcp`, `operador` ou `leitura` (mesma instrução).

| Perfil | Pode |
|---|---|
| admin | tudo, inclusive linhas/máquinas/setores |
| pcp | cadastrar/editar listas, itens e nestings; iniciar, concluir, cancelar e reabrir |
| operador | consultar; iniciar nesting, registrar quantidades cortadas e concluir |
| leitura | somente consultar |

## 2. Rodar localmente
```bash
copy .env.example .env.local     # Windows (cmd). Edite o .env.local com URL e chave anon
npm install
npm run dev
```
Abra http://localhost:3000. Use **somente** a chave `anon`/`publishable` (Project Settings → API). Nunca a `service_role`.

Outros comandos: `npm run lint` · `npm run typecheck` · `npm test` (parser do Excel) · `npm run build`.

## 3. Estrutura
```
supabase/migrations/   SQL versionado (tabelas, regras, RLS, funções, views)
src/lib/               supabase.ts, tipos, formatação, erros, consultas (lists/items/nestings/dashboard), excel-paste.ts (+ teste)
src/components/        AuthProvider, AppShell (menu/login guard), Modal, ItemFormModal, NestingForm, ui
src/app/               páginas: / (dashboard), listas, ops (+colar, [id]), nestings (+novo, [id], editar), setores, acompanhamento, login
```

## 4. Como usar
1. **Listas** → *Nova lista*: número (ex.: `08`), nome/equipamento (ex.: `CONTEINER`), tipo, data de entrega.
2. **Catálogo de itens**: define a linha de produção de cada item (importado da planilha; atualize quando mudar).
3. **Colar do ERP/Excel** (`OPs e peças → Colar do Excel`): escolha a lista e cole a aba DADOS **com a linha de cabeçalho** (recomendado): as colunas são localizadas pelo nome, então funcionam os layouts do Roll-On/Poli (`OP | Qtde | Código | Descrição | Código MP | Qtde | Und | Descrição Matéria prima | Linha | Fabricação`) e do Coletor/Lifter (com `Und` logo após a `Qtde`). Linhas acima do cabeçalho (ex.: a linha do equipamento) são ignoradas. Sem cabeçalho, vale a ordem `OP | Qtde | Código | Descrição | Código MP | Qtde MP | Und | Descrição MP`.
   - A **linha de produção** vem da coluna `Linha` (código ERP) quando colada; senão do **catálogo** (Código → código ERP → linha); senão da linha padrão escolhida. Itens sem linha (comprados, conjuntos, não cadastrados) são **ignorados e contados**; se quiser, escolha uma "linha para itens fora do catálogo" (útil em listas Leniors/Avulsos).
   - A prévia tem abas (Prontas / Duplicadas / Com erro / Sem linha), permite corrigir células e remover linhas. Linhas com erro nunca são gravadas.
   - Valores `#N/A` do Excel contam como vazios. Vírgula decimal e milhar com ponto são entendidos (a prévia avisa em `1.500`).
   - **Duplicidade:** mesma lista + linha + OP + Código do item + Código MP. A mesma OP e item com matéria-prima diferente **não** é duplicada.
4. **Nestings** → *Novo nesting*: **cole o texto do PDF do nesting** (Ctrl+A, Ctrl+C no PDF; se tiver 2+ páginas, cole todas) em “Preencher a partir do PDF” e o sistema preenche código, data, chapa, máquina (ex.: “Calfran Laser Fiber - 6000” → Laser 6KW) e as peças, casando **OP + código** com os itens cadastrados (quantidade = coluna “Chapa” do PDF). Corpo de prova (sem OP) é ignorado; peças de listas ainda não importadas são listadas como pendentes. Ou preencha manualmente: código sugerido (L0001…), máquina (Laser 6KW, 12KW, 40KW ou Bobina), chapa/material (texto livre, ex.: `1/2"`, `Inox 12`), data. Busque peças de **qualquer lista** (só linhas de laser) e informe a quantidade de cada. Na página do nesting: **Iniciar corte → Registrar quantidades → Concluir** (conferência item a item), **Cancelar** e **Reabrir** (com motivo).
   - Peça sem OP ou fora de lista: cadastre-a numa lista do tipo **Avulsos** (OP opcional, vira `S/OP`) e use *Cadastrar peça avulsa* na própria tela do nesting.
5. **Leniors**: escolha a lista Leniors; clique em Corte/Dobra/Acabamento para alternar *Aguardando → Concluída → Não se aplica*; informe a nota fiscal por OP. A OP fica finalizada quando as 3 etapas estão Concluída ou Não se aplica; o resumo mostra total, finalizadas e %.
6. **Detalhe da OP**: necessário, programado, cortado, pendentes e os nestings da OP.

## 5. Regras de negócio (garantidas no banco, não só na tela)
- **Nesting pode misturar listas** (cada peça pertence à sua lista). Só aceita peças de **linhas de laser** (`production_lines.allows_nesting`; ligado para LASER 6KW/12KW/40KW e variantes DOBRA/USINAGEM; o admin muda em *Setores e linhas*).
- Código do nesting: **L0001, L0002…** (único no sistema inteiro, independente da máquina). Máquinas: `laser_machines` (Laser 6KW, Laser 12KW, Laser 40KW, Bobina).
- Programado > 0; cortado ≥ 0 e ≤ programado. Soma programada de uma OP acima do necessário **exige confirmação explícita** (`allow_excess`).
- Status só muda por funções (`start/complete/cancel/reopen_nesting`). Concluído/Cancelado não aceitam edição comum.
- Cancelar: Programado sempre; Em produção só sem peças cortadas; Concluído → use Reabrir (**somente admin e pcp**).
- Totais sem duplicar: Programado/Em produção conta o programado; **Concluído conta só o cortado**; Cancelado não conta.
- Nada é excluído: listas e itens são **arquivados**, nestings são **cancelados**.

## 6. Segurança
- Supabase Auth + RLS em todas as tabelas; o visitante anônimo não acessa nada. Usuários novos ficam inativos até um admin liberar.
- Segredos fora de `NEXT_PUBLIC_`. A chave `anon` é pública por natureza; **a proteção real é o RLS**.
- **Não foi feita auditoria de segurança.** Revise as políticas antes de usar com dados reais em produção.
- Itens/nestings antigos do protótipo sem lista/linha/máquina continuam existindo, mas só podem ser editados depois de receberem esses campos.

## 7. Deploy na Vercel
Importe o repositório, defina `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` e faça o deploy. Em Supabase → Auth → URL Configuration, adicione a URL da Vercel.

## 8. Decisões técnicas
- Removido `@import "tailwindcss"` do CSS: Tailwind não estava instalado/configurado e o CSS é escrito à mão.
- `production_orders`: **cada linha é um item de uma OP** (UUID interno + `op_number` como dado de negócio).
- **Linhas** (migração 0007): as da planilha de controle (6KW e 40KW separados, 12KW etc.), ligadas aos códigos do ERP em `erp_line_codes` (vários códigos podem apontar para a mesma linha; `line_id` nulo = linha do ERP não controlada aqui, como montagem e tubulação). As 3 linhas antigas `LASER 6KW/40KW…` ficaram inativas (itens antigos continuam válidos).
- Operações críticas são funções PostgreSQL (transação única), chamadas por `supabase.rpc`.
- Autenticação no cliente + RLS no banco, sem middleware.

## 9. Validação (o que foi e não foi verificado)
- Executado: `npm test` (22 testes passando: parser da colagem e parser do texto de nesting); verificação sintática TypeScript/TSX em 39 arquivos (sem erros).
- **Não executado:** `npm run typecheck`, `npm run lint`, `npm run build` e SQL contra PostgreSQL/Supabase. A instalação do npm excedeu o tempo disponível neste ambiente. Rode essas verificações depois de `npm install` no seu Windows e aplique as migrations primeiro em um projeto Supabase novo.

## 10. Limitações e pendências
- **PDF de nesting:** a leitura é feita colando o **texto** do PDF (sem dependências). Upload direto do arquivo PDF (e de várias páginas/arquivos de uma vez) ainda não existe. A tabela do PDF casa com os itens por OP + código; peças das listas ainda não importadas (ex.: Leniors 83) ficam pendentes.
- O relatório de planejamento do ERP (`.txt`, “Confirmação do Planejamento”) traz a **linha de cada OP** e a data; em 4 de 121 OPs a linha dele difere do catálogo. **Ainda não é importado.**
- Etapa de **cementação** (Coletor/Lifter: Cementado / Sem cementar / Supertrat) e **anexo de croqui** em peças avulsas (desenho à mão) ainda não existem.
- **Percentuais por linha por lista** (planilha de controle de fabricação, imagem de 05/03/2026) **ainda não implementados**: dependem de definir a fórmula (peças prontas ÷ peças necessárias por linha?) e de apontamentos nas demais linhas (GEKA, guilhotina, serra...).
- Leniors: o corte **não** é preenchido automaticamente pelos nestings (marcação manual). A planilha semanal "Lista_Leniors" (programação por dia) não foi modelada.
- Itens sem linha no catálogo (80% das linhas da lista Roll-On) são ignorados na colagem por design.
- Linhas do ERP 340/341 (AMB laser), 371, 380, 390, 391 e as de equipamento não estão ligadas a nenhuma linha. Ligue em `erp_line_codes` se quiser controlá-las.
- Sem tela para gerenciar usuários nem para editar o mapeamento `erp_line_codes`.
- Sem exclusão física pela interface.


### Migration 0010 — Nesting por material e espessura

Um nesting aceita somente peças da mesma combinação de material (prioriza Código MP) e espessura. A regra é validada no banco e também na tela de criação/edição.
