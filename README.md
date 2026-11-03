# Controle Geral de Produção (CGP)

Sistema interno para controle da produção: listas, OPs/peças, colagem do ERP/Excel, catálogo item→linha, **nestings de corte (laser/bobina)**, acompanhamento Leniors e dashboard.
Stack: Next.js (App Router) · TypeScript · React · Supabase (PostgreSQL + Auth) · Lucide.

> **Status honesto:** fases 1 a 5, o acompanhamento Leniors e parte da 7 estão implementados, mas **o código ainda não foi compilado nem testado contra um Supabase real** (veja "Validação"). O acompanhamento por lista e linha (planilha de percentuais) existe, mas a **fórmula é uma proposta minha** (veja "Acompanhamento").

## Pré-requisitos (Windows)
- Node.js 22 LTS (para `npm test` é preciso 22.18+; para rodar o sistema, 20.9+ basta) e VS Code.
- Um projeto Supabase (gratuito serve).

## 1. Configurar o Supabase
1. Crie o projeto em supabase.com.
2. **SQL Editor** → execute, **nesta ordem**, o conteúdo de cada arquivo de `supabase/migrations/`:
   `0001_schema_inicial.sql` → `0002_modelo_central.sql` → `0003_auth_e_rls.sql` → `0004_funcoes_de_negocio.sql` → `0005_views_e_dashboard.sql` → `0006_nesting_laser_e_codigo.sql` → `0007_modelo_real.sql` → `0008_importacao_linha_planilha.sql` → `0009_exclusao.sql` → `0010_espessura.sql` → `0011_acompanhamento.sql`.
   - Se você **já executou o antigo `schema.sql`**, pule a 0001 e rode da 0002 em diante (seus dados são preservados).
   - Todas podem ser rodadas de novo sem erro.
3. **Catálogo de itens:** depois de entrar no sistema, abra **Catálogo de itens** e importe `supabase/seed/catalogo_itens.tsv` (15.840 itens da aba MAQUINA da planilha Roll-On). Sem o catálogo, a colagem não descobre a linha dos itens.
4. **Auth → Sign In / Providers**: desligue *Allow new users to sign up* (o sistema não tem cadastro público).
5. **Auth → Users → Add user**: crie seu usuário (e-mail + senha, marque *Auto Confirm*).

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
4. **Nestings** → *Novo nesting*: **escolha o(s) arquivo(s) PDF do nesting** (selecione todas as páginas/arquivos de uma vez) **ou cole o texto** copiado do PDF (Ctrl+A, Ctrl+C; preenche ao colar) em “Preencher a partir do PDF”. Com o arquivo, o sistema reconstrói a tabela pela posição do texto; com o texto colado, ele identifica as linhas pelas colunas finais (Chapa, Total, Faltam, dimensões, tempo), mesmo quando o PDF cola tudo em uma linha. Preenche código, data, chapa, **espessura**, máquina (ex.: “Calfran Laser Fiber - 6000” → Laser 6KW) e as peças, casando **OP + código** com os itens cadastrados (quantidade = coluna “Chapa” do PDF). Corpo de prova (sem OP) é ignorado; peças de listas ainda não importadas são listadas como pendentes. Ou preencha manualmente: código sugerido (L0001…), máquina (Laser 6KW, 12KW, 40KW ou Bobina), chapa/material (texto livre, ex.: `1/2"`, `Inox 12`), data. Busque peças de **qualquer lista** (só linhas de laser) e informe a quantidade de cada. Na página do nesting: **Iniciar corte → Registrar quantidades → Concluir** (conferência item a item), **Cancelar** e **Reabrir** (com motivo).
   - **Espessura:** o sistema converte a descrição da matéria-prima em mm (`3/8` ou `(9,50 mm)` → 9,5; `CHAPA 8` = bitola 8 → 4,17; `1 1/2` → 38,1) e grava no item. Em *OPs e peças* há filtro e coluna de espessura e o botão **Calcular espessuras** (para itens já cadastrados). No nesting, ao escolher a **espessura da chapa**, a busca mostra só peças daquela espessura. Tubo, cantoneira e barra redonda ficam sem espessura.
   - Peça sem OP ou fora de lista: cadastre-a numa lista do tipo **Avulsos** (OP opcional, vira `S/OP`) e use *Cadastrar peça avulsa* na própria tela do nesting.
5. **Leniors**: escolha a lista Leniors; clique em Corte/Dobra/Acabamento para alternar *Aguardando → Concluída → Não se aplica*; informe a nota fiscal por OP. A OP fica finalizada quando as 3 etapas estão Concluída ou Não se aplica; o resumo mostra total, finalizadas e %.
6. **Acompanhamento** (`/acompanhamento`): matriz *linhas × listas* com o percentual de peças produzidas (cores: vermelho 0%, amarelo em andamento, verde 100%), total e data de entrega de cada lista. Clique em uma célula para **apontar a produção** (`/acompanhamento/apontar`). Fórmula adotada (confirme se bate com a sua planilha): **% da linha = peças produzidas ÷ peças necessárias** dos itens da linha; **total da lista** = soma produzida ÷ soma necessária (ponderado pela quantidade de peças). O produzido vem dos **nestings** (peças cortadas) nas linhas `LASER 6KW/12KW/40KW` e de **apontamento manual** nas demais (inclusive laser + dobra/usinagem); a origem é a coluna `production_lines.progress_source`.
7. **Detalhe da OP**: necessário, programado, cortado, pendentes e os nestings da OP.

## 5. Regras de negócio (garantidas no banco, não só na tela)
- **Nesting pode misturar listas** (cada peça pertence à sua lista). Só aceita peças de **linhas de laser** (`production_lines.allows_nesting`; ligado para LASER 6KW/12KW/40KW e variantes DOBRA/USINAGEM; o admin muda em *Setores e linhas*).
- Código do nesting: **L0001, L0002…** (único no sistema inteiro, independente da máquina). Máquinas: `laser_machines` (Laser 6KW, Laser 12KW, Laser 40KW, Bobina).
- Programado > 0; cortado ≥ 0 e ≤ programado. Soma programada de uma OP acima do necessário **exige confirmação explícita** (`allow_excess`).
- Status só muda por funções (`start/complete/cancel/reopen_nesting`). Concluído/Cancelado não aceitam edição comum.
- Cancelar: Programado sempre; Em produção só sem peças cortadas; Concluído → use Reabrir (**somente admin e pcp**).
- Totais sem duplicar: Programado/Em produção conta o programado; **Concluído conta só o cortado**; Cancelado não conta.
- **Exclusão definitiva** (migração 0009; botões *Excluir* nas telas e nos detalhes; confirmação com o que será apagado; admin e pcp). O acesso direto de DELETE pela API continua bloqueado: tudo passa por funções que verificam dependências e gravam o que foi apagado em `deletion_log`:
  - **Item/OP:** só exclui se não estiver em nenhum nesting, não tiver etapas/apontamentos de produção e não tiver nota fiscal. Pode excluir vários de uma vez (caixas de seleção em *OPs e peças*); os bloqueados são mantidos e listados com o motivo.
  - **Lista:** sem itens, exclui. Com itens, só se **todos** puderem ser excluídos (tudo ou nada), com confirmação digitando o nome da lista.
  - **Nesting:** Programado/Cancelado sem peças cortadas, admin e pcp; **Em produção/Concluído só o administrador**, digitando o código. As OPs não são afetadas (o saldo é recalculado).
  - Arquivar (listas e itens) e Cancelar (nestings) continuam existindo como alternativa que preserva o registro.

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
- Executado: `npm test` (60 testes, incluindo 36 descrições reais de MP → espessura e a leitura por posição de PDFs reais; o teste de PDF precisa do `pdfjs-dist` instalado e é pulado sem ele: parser da colagem, incluindo as abas DADOS reais Roll-On, Poli e Lifter, o catálogo de 15.840 itens e os 9 PDFs de nesting de exemplo) e checagem TypeScript **com stubs** das bibliotecas.
- **Não executado** (sem internet no ambiente de desenvolvimento): `npm install`, `npm run lint`, `npm run build` e **todo o SQL** (nenhum PostgreSQL disponível). Execute as migrações em um projeto Supabase de teste primeiro.

## 10. Limitações e pendências
- **PDF de nesting:** lido no navegador com pdf.js (arquivo `public/pdf.worker.mjs`, copiado no `npm install`). **Não testado no navegador** (só em Node, com os 9 PDFs de exemplo). A tabela do PDF casa com os itens por OP + código; peças das listas ainda não importadas (ex.: Leniors 83) ficam pendentes.
- O relatório de planejamento do ERP (`.txt`, “Confirmação do Planejamento”) traz a **linha de cada OP** e a data; em 4 de 121 OPs a linha dele difere do catálogo. **Ainda não é importado.**
- Etapa de **cementação** (Coletor/Lifter: Cementado / Sem cementar / Supertrat) e **anexo de croqui** em peças avulsas (desenho à mão) ainda não existem.
- **Acompanhamento:** a fórmula (peças produzidas ÷ necessárias, ponderada por quantidade) é uma proposta; o apontamento é por item (quantidade produzida), sem registro de data/operador por apontamento; não há tela de histórico de apontamentos.
- Leniors: o corte **não** é preenchido automaticamente pelos nestings (marcação manual). A planilha semanal "Lista_Leniors" (programação por dia) não foi modelada.
- Itens sem linha no catálogo (80% das linhas da lista Roll-On) são ignorados na colagem por design.
- Linhas do ERP 340/341 (AMB laser), 371, 380, 390, 391 e as de equipamento não estão ligadas a nenhuma linha. Ligue em `erp_line_codes` se quiser controlá-las.
- Sem tela para gerenciar usuários nem para editar o mapeamento `erp_line_codes`.
- Não há tela para consultar o `deletion_log` (consulte pelo Table Editor do Supabase).
