# ⚙️ Controle Geral de Produção

Sistema que estou desenvolvendo para **organizar e facilitar o acompanhamento da produção**.

A ideia é centralizar informações que hoje ficam espalhadas em planilhas e deixar o controle de **listas, OPs, nestings e produção** mais simples e organizado.

> 🚧 **Projeto em desenvolvimento**
>
> Algumas funcionalidades ainda estão sendo implementadas e podem sofrer alterações conforme o sistema evolui.

---

## 📌 Sobre o projeto

O sistema foi pensado para acompanhar algumas etapas do processo de produção, desde o cadastro das listas até o acompanhamento das peças e nestings.

### Principais funções

- 📋 Cadastro e gerenciamento de listas
- 🏷️ Cadastro e acompanhamento de OPs
- 🔩 Controle de nestings
- 🔗 Relação entre listas, OPs e nestings
- 🏭 Definição da linha de produção
- ⚙️ Acompanhamento dos equipamentos
- 📊 Visualização das informações da produção
- ✏️ Alteração dos registros
- 🗑️ Exclusão de registros

---

## 📋 Tipos de listas

Atualmente o sistema trabalha com os seguintes tipos:

| Tipo | Descrição |
|---|---|
| 🚛 Rodoviário | Produção de componentes rodoviários |
| 🌱 Ambiental | Produção de componentes ambientais |
| 🔧 Pós-vendas | Peças relacionadas ao pós-vendas |
| 📦 Avulsos | Produção interna da fábrica |
| 🏗️ Leniors | Produção interna destinada a processos posteriores |

---

## 🏭 Linhas de produção

O sistema possui as seguintes linhas cadastradas:

**GEKA**
- GEKA
- GEKA DOBRA
- GEKA USINAGEM

**Guilhotina**
- GUILHOTINA
- GUILHOTINA DOBRA
- GUILHOTINA USINAGEM

**Laser**
- LASER 6KW/40KW
- LASER 6KW/40KW DOBRA
- LASER 6KW/40KW USINAGEM

**Serra**
- SERRA
- SERRA DOBRA
- SERRA USINAGEM

**Usinagem**
- USINAGEM

---

## 🛠️ Tecnologias

O projeto está sendo desenvolvido utilizando:

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)

---

## 🚀 Rodando o projeto

Clone o repositório:

```bash
git clone https://github.com/SEU_USUARIO/controle-geral-producao.git
cd controle-geral-producao
```

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env.local` na raiz do projeto:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Depois execute:

```bash
npm run dev
```

O projeto estará disponível em:

```text
http://localhost:3000
```

---

## 🗺️ Próximos passos

Algumas das coisas que ainda pretendo implementar ou melhorar:

- [ ] Melhorar o acompanhamento da produção
- [ ] Evoluir o controle de nestings
- [ ] Melhorar os indicadores do dashboard
- [ ] Automatizar algumas tarefas que hoje são feitas manualmente
- [ ] Adicionar novos controles conforme a necessidade do processo

---

## 📈 Desenvolvimento

Esse projeto está sendo desenvolvido aos poucos, com foco em **resolver problemas reais do dia a dia da produção**.

A ideia não é criar algo complicado, mas sim uma ferramenta que realmente ajude no controle e acompanhamento do processo.

---

**Desenvolvido por mim durante o processo de automatização e melhoria do controle de produção.**