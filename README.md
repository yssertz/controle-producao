# ⚙️ Controle Geral de Produção (CGP)

<div align="center">

  **Gestão, organização e acompanhamento da produção industrial.**

  Centralizando listas, ordens de produção, peças, nestings e processos de fabricação em um único sistema.

  ![Status](https://img.shields.io/badge/Status-Em%20desenvolvimento-38BDF8?style=for-the-badge)
  ![Next.js](https://img.shields.io/badge/Next.js-App%20Router-000000?style=for-the-badge&logo=next.js)
  ![TypeScript](https://img.shields.io/badge/TypeScript-Typed-3178C6?style=for-the-badge&logo=typescript)
  ![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Auth-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)

</div>

---

## 📌 Sobre o projeto

O **Controle Geral de Produção (CGP)** é um sistema interno desenvolvido para centralizar e organizar o controle da produção industrial.

O projeto surgiu da necessidade de substituir controles dispersos em planilhas por uma aplicação integrada, capaz de acompanhar diferentes etapas do processo produtivo.

A aplicação permite gerenciar listas, ordens de produção (OPs), peças, nestings de corte a laser e bobina, além de acompanhar processos específicos, como a produção Leniors.

O objetivo é facilitar o acesso às informações, reduzir atividades manuais e proporcionar uma visão mais organizada do andamento da produção.

## 🚀 Funcionalidades

### 📋 Gestão de listas e ordens de produção
- Cadastro e gerenciamento de listas de produção.
- Organização por tipo de equipamento e categoria.
- Cadastro e gerenciamento de OPs e peças.
- Associação de peças às respectivas listas e linhas de produção.
- Controle de quantidades necessárias, programadas e produzidas.
- Consulta detalhada das ordens de produção.

### 📥 Importação do ERP e Excel
- Colagem de dados diretamente do ERP ou Excel.
- Identificação automática das colunas pelo cabeçalho.
- Suporte aos formatos Roll-On, Poli, Coletor e Lifter.
- Identificação da linha de produção através do catálogo de itens e códigos do ERP.
- Pré-visualização antes de importar.
- Identificação de duplicidades, erros e itens sem linha definida.
- Possibilidade de corrigir ou remover registros antes da gravação.

### 🗂️ Catálogo de itens
- Importação de catálogo de itens.
- Associação entre código do item e linha de produção.
- Integração com o processo de importação de OPs.
- Cálculo e identificação automática de espessuras de matéria-prima.

### 🔩 Gestão de nestings
- Cadastro manual ou importação de informações de PDFs.
- Identificação automática de peças, OPs, quantidades e materiais.
- Suporte a diferentes máquinas de corte.
- Controle de espessura das chapas.
- Associação de peças de diferentes listas no mesmo nesting.
- Identificação de peças pendentes de importação.
- Controle de quantidades programadas e cortadas.
- Histórico de status e operações.

**Fluxo de produção:**

`Programado → Em produção → Concluído`

Também são disponibilizadas opções de cancelamento e reabertura, conforme as permissões do usuário.

### 🏭 Processos de fabricação

O sistema permite organizar a produção de acordo com as linhas utilizadas na fábrica:

- GEKA
- GEKA DOBRA
- GEKA USINAGEM
- GUILHOTINA
- GUILHOTINA DOBRA
- GUILHOTINA USINAGEM
- LASER 6KW
- LASER 12KW
- LASER 40KW
- LASER DOBRA
- LASER USINAGEM
- SERRA
- SERRA DOBRA
- SERRA USINAGEM
- USINAGEM
- BOBINA

As linhas podem ser configuradas conforme as necessidades da produção.

### 📦 Acompanhamento Leniors
- Controle das etapas de corte, dobra e acabamento.
- Status individual por etapa.
- Identificação de etapas não aplicáveis.
- Registro de notas fiscais por OP.
- Acompanhamento de OPs finalizadas e pendentes.
- Resumo de produção com percentuais de conclusão.

### 📊 Dashboard e acompanhamento
- Visualização geral das informações de produção.
- Matriz de acompanhamento por linhas e listas.
- Percentual de produção por linha.
- Identificação visual de etapas concluídas e pendentes.
- Quantidades necessárias e produzidas.
- Datas de entrega das listas.
- Apontamento de produção por item.

### 🗑️ Gerenciamento e exclusões
- Exclusão de listas, OPs, itens e nestings conforme permissões.
- Verificação de dependências antes da exclusão.
- Confirmação de operações críticas.
- Registro das exclusões no banco de dados.
- Opções de arquivamento e cancelamento para preservar registros.

## 🛠️ Tecnologias utilizadas

| Tecnologia | Aplicação |
|---|---|
| Next.js | Estrutura da aplicação e rotas |
| React | Construção das interfaces |
| TypeScript | Tipagem e organização do código |
| Supabase | Backend, autenticação e banco de dados |
| PostgreSQL | Armazenamento e regras de negócio |
| Lucide | Ícones da interface |
| Vercel | Hospedagem e deploy |

## 🔐 Segurança e permissões

A aplicação utiliza Supabase Auth e Row Level Security (RLS) para controlar o acesso aos dados.

Todo usuário precisa ser autorizado por um administrador antes de acessar o sistema.

| Perfil | Permissões |
|---|---|
| Admin | Acesso completo e gerenciamento de configurações |
| PCP | Gerenciamento de listas, itens e nestings |
| Operador | Consulta e operações de produção autorizadas |
| Leitura | Somente consulta |

As operações críticas são executadas através de funções PostgreSQL, garantindo validações e transações no banco de dados.

**Observação:** o sistema ainda não passou por uma auditoria de segurança. As políticas devem ser revisadas antes de sua utilização em produção com dados reais.

## 💻 Instalação e configuração

### Pré-requisitos

- Windows.
- Node.js 22 LTS.
- VS Code.
- Projeto Supabase.

### 1. Clonar o repositório

```bash
git clone https://github.com/yssertz/controle-geral-producao.git

cd controle-geral-producao
```

### 2. Instalar as dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

Crie o arquivo `.env.local` a partir do exemplo:

```bash
copy .env.example .env.local
```

Configure as credenciais do Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=SUA_URL_SUPABASE
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

Utilize somente a chave pública `anon` ou `publishable` no ambiente do navegador. Nunca exponha a chave `service_role`.

### 4. Configurar o banco de dados

No painel do Supabase, acesse o SQL Editor e execute as migrations da pasta `supabase/migrations/`, na seguinte ordem:

```text
0001_schema_inicial.sql
0002_modelo_central.sql
0003_auth_e_rls.sql
0004_funcoes_de_negocio.sql
0005_views_e_dashboard.sql
0006_nesting_laser_e_codigo.sql
0007_modelo_real.sql
0008_importacao_linha_planilha.sql
0009_exclusao.sql
0010_espessura.sql
0011_acompanhamento.sql
```

Se o banco já possuir o antigo `schema.sql`, siga a orientação específica da documentação de migração para não recriar o esquema inicial.

Após as migrations:

1. Importe o catálogo de itens localizado em `supabase/seed/catalogo_itens.tsv`.
2. Configure o Supabase Auth.
3. Desative o cadastro público de usuários.
4. Crie o primeiro usuário administrador.
5. Libere os demais usuários conforme seus respectivos perfis.

### 5. Executar localmente

```bash
npm run dev
```

A aplicação estará disponível em:

```text
http://localhost:3000
```

### Outros comandos

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 📁 Estrutura do projeto

```text
├── public/
│   └── pdf.worker.mjs
│
├── src/
│   ├── app/
│   │   ├── dashboard/
│   │   ├── listas/
│   │   ├── ops/
│   │   ├── nestings/
│   │   ├── setores/
│   │   ├── acompanhamento/
│   │   └── login/
│   │
│   ├── components/
│   │   ├── AuthProvider
│   │   ├── AppShell
│   │   ├── Modal
│   │   ├── ItemFormModal
│   │   ├── NestingForm
│   │   └── ui/
│   │
│   └── lib/
│       ├── supabase.ts
│       ├── tipos
│       ├── formatação
│       ├── consultas
│       └── excel-paste.ts
│
├── supabase/
│   ├── migrations/
│   └── seed/
│
├── .env.example
├── package.json
└── README.md
```

*Estrutura resumida da aplicação.*

## ⚙️ Regras de negócio

Algumas validações importantes são realizadas diretamente no banco de dados:

- Nestings podem conter peças de diferentes listas.
- Cada nesting possui um código único no formato `L0001`, `L0002` etc.
- Apenas linhas autorizadas podem participar de nestings.
- Cada peça possui controle de quantidade programada e cortada.
- A quantidade cortada não pode ultrapassar a quantidade programada.
- O excedente de programação exige confirmação explícita.
- Nestings concluídos ou cancelados possuem restrições de edição.
- O cancelamento e a reabertura seguem regras específicas de permissão.
- Os totais de produção consideram as quantidades cortadas nos nestings concluídos, evitando duplicidade.

### Cálculo do acompanhamento

O percentual de produção é calculado considerando a quantidade produzida em relação à quantidade necessária.

```text
Percentual = (Quantidade produzida / Quantidade necessária) × 100
```

O percentual total da lista é ponderado pela quantidade de peças, e não pela média simples dos percentuais das linhas.

**Importante:** essa fórmula é uma proposta de implementação e ainda precisa ser validada em relação à planilha original de acompanhamento.

## 🧪 Validação e testes

O projeto possui testes automatizados para validar principalmente os processos de importação e interpretação de dados.

**Verificações realizadas:**
- 60 testes do parser de Excel e regras relacionadas.
- Testes com layouts reais Roll-On, Poli e Lifter.
- Testes com catálogo de 15.840 itens.
- Testes com descrições de matérias-primas e conversão de espessuras.
- Testes de leitura por posição de texto em PDFs de nesting.
- Checagem TypeScript utilizando stubs de bibliotecas.

**O que ainda não foi validado:**
- Instalação completa das dependências no ambiente de desenvolvimento.
- Build de produção.
- Lint.
- Execução das migrations em PostgreSQL/Supabase real.
- Testes completos da aplicação no navegador.
- Fluxos reais de autenticação e permissões.

Portanto, o sistema ainda precisa passar por uma validação integrada antes de ser considerado pronto para produção.

## 🚧 Limitações e próximos passos

- [ ] Validar migrations em um projeto Supabase de teste.
- [ ] Executar build e testes completos de integração.
- [ ] Testar a leitura de PDFs diretamente no navegador.
- [ ] Implementar importação do relatório de planejamento do ERP.
- [ ] Implementar controle de cementação.
- [ ] Permitir anexar croquis em peças avulsas.
- [ ] Criar histórico detalhado de apontamentos de produção.
- [ ] Integrar automaticamente os nestings ao acompanhamento Leniors.
- [ ] Desenvolver consulta do histórico de exclusões.
- [ ] Implementar gerenciamento de usuários pela interface.
- [ ] Desenvolver gerenciamento visual dos códigos de linha do ERP.

## 🌐 Deploy

O projeto pode ser publicado na Vercel.

Após importar o repositório, configure as variáveis de ambiente:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Também é necessário configurar a URL da aplicação em:

`Supabase → Authentication → URL Configuration`

## 📝 Decisões técnicas

- Utilização do Supabase como backend e PostgreSQL como banco de dados.
- Operações críticas implementadas como funções PostgreSQL e chamadas via `supabase.rpc`.
- Autenticação no cliente com proteção de dados por RLS.
- Identificação das linhas de produção através do catálogo e códigos do ERP.
- Cada registro de `production_orders` representa um item de uma OP.
- Código de negócio da OP separado do identificador UUID interno.
- Controle de espessuras de matérias-primas em milímetros.
- Interpretação de PDFs realizada no navegador utilizando PDF.js.

---

<div align="center">

  **Controle Geral de Produção**

  Desenvolvido por [@yssertz](https://github.com/yssertz)

  *Tecnologia aplicada à organização e eficiência industrial.*

</div>
