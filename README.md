# Controle Geral de Produção

Sistema que estou desenvolvendo para ajudar no controle e acompanhamento da produção da fábrica.

A ideia é centralizar algumas informações que hoje ficam espalhadas em planilhas e facilitar o acompanhamento das listas, OPs, nestings e produção.

## O que o sistema faz

Atualmente o projeto está sendo desenvolvido para trabalhar com:

- Cadastro e gerenciamento de listas de produção
- Cadastro e acompanhamento de OPs
- Controle de nestings
- Relação entre listas, OPs e nestings
- Acompanhamento da produção
- Definição da linha de produção
- Controle dos equipamentos utilizados
- Exclusão e alteração dos registros
- Dashboard com informações da produção

## Tipos de listas

O sistema foi pensado inicialmente para trabalhar com:

- Rodoviário
- Ambiental
- Pós-vendas
- Avulsos
- Leniors

Cada tipo de lista pode ter suas próprias características e necessidades dentro do processo de produção.

## Linhas de produção

As linhas utilizadas atualmente são:

- GEKA
- GEKA DOBRA
- GEKA USINAGEM
- GUILHOTINA
- GUILHOTINA DOBRA
- GUILHOTINA USINAGEM
- LASER 6KW/40KW
- LASER 6KW/40KW DOBRA
- LASER 6KW/40KW USINAGEM
- SERRA
- SERRA DOBRA
- SERRA USINAGEM
- USINAGEM

## Tecnologias

O projeto está sendo desenvolvido utilizando:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Supabase
- PostgreSQL

## Como rodar o projeto

Primeiro instale as dependências:

```bash
npm install
```

Depois configure as variáveis de ambiente no arquivo `.env.local`.

Exemplo:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Depois é só iniciar o projeto:

```bash
npm run dev
```

O sistema ficará disponível em:

```text
http://localhost:3000
```

## Objetivo do projeto

Esse projeto ainda está em desenvolvimento.

A ideia é ir substituindo aos poucos alguns controles que atualmente são feitos em planilhas, deixando o processo mais organizado e facilitando o acompanhamento da produção.

Também pretendo adicionar outras funções conforme o sistema for sendo utilizado e as necessidades forem aparecendo.

---

Projeto desenvolvido por mim como parte do processo de melhoria e automatização do controle de produção.