# Métricas de uso no Atlas Charts

Lista de gráficos para acompanhar o uso do PagueSuaParte direto do banco, sem subir aplicação e sem colocar rastreador no site. Cada gráfico traz a coleção, o tipo, os campos e a consulta pronta para colar.

## Como montar

1. No Atlas, abra **Charts** e crie um painel (por exemplo, "PagueSuaParte: uso").
2. Em **Data Sources**, ligue o banco de produção e as coleções `users`, `groups`, `expenses`, `plans`, `recurrences`, `inbox`, `reminder_log` e `push_subscriptions`.
3. Para cada gráfico: **Add Chart**, escolha a coleção indicada, cole a consulta na barra **Query** (ela aceita a lista entre colchetes) e aplique. Depois escolha o tipo de gráfico e arraste os campos como indicado.
4. Deixe a atualização automática do painel em 1 hora ou mais: o plano gratuito do Charts tem limite mensal de dados.

## Cuidados com dados pessoais

- Todas as consultas devolvem só contagens e somas. Nenhuma devolve nome, e-mail, chave Pix, descrição de despesa ou limite de plano.
- Não crie gráfico do tipo tabela com documentos crus dessas coleções.
- Mantenha o painel privado: não ative link público nem incorporação.

## O que estes números não mostram

- Visitas e aberturas do app: o banco só registra ações gravadas (conta criada, grupo, despesa, pagamento, resposta de plano). Para visitas, use o Vercel Web Analytics.
- Semanas começam na segunda-feira, no horário de São Paulo.

## 1. Números do topo

### Pessoas cadastradas

- Coleção: `users`
- Tipo de gráfico: Number
- Campos: Aggregation: `pessoas`

```json
[
  {
    "$count": "pessoas"
  }
]
```

### Novas contas nos últimos 30 dias

- Coleção: `users`
- Tipo de gráfico: Number
- Campos: Aggregation: `pessoas`

```json
[
  {
    "$match": {
      "$expr": {
        "$gte": [
          "$createdAt",
          {
            "$dateSubtract": {
              "startDate": "$$NOW",
              "unit": "day",
              "amount": 30
            }
          }
        ]
      }
    }
  },
  {
    "$count": "pessoas"
  }
]
```

### Grupos

- Coleção: `groups`
- Tipo de gráfico: Number
- Campos: Aggregation: `grupos`

```json
[
  {
    "$count": "grupos"
  }
]
```

### Despesas lançadas e valor total

- Coleção: `expenses`
- Tipo de gráfico: Number (dois gráficos com a mesma consulta)
- Campos: Um gráfico com `despesas`, outro com `valorReais`
- Observação: Cada parcela e cada mês de despesa fixa é um documento, então conta como uma despesa.

```json
[
  {
    "$group": {
      "_id": null,
      "despesas": {
        "$sum": 1
      },
      "valorReais": {
        "$sum": {
          "$divide": [
            "$amountCents",
            100
          ]
        }
      }
    }
  },
  {
    "$project": {
      "_id": 0
    }
  }
]
```

### Pessoas com aviso por push ligado

- Coleção: `push_subscriptions`
- Tipo de gráfico: Number
- Campos: Aggregation: `pessoas`

```json
[
  {
    "$group": {
      "_id": "$uid"
    }
  },
  {
    "$count": "pessoas"
  }
]
```

### Despesas fixas ativas

- Coleção: `recurrences`
- Tipo de gráfico: Number
- Campos: Aggregation: `fixas`

```json
[
  {
    "$match": {
      "active": true
    }
  },
  {
    "$count": "fixas"
  }
]
```

## 2. Crescimento por semana

### Novas contas por semana

- Coleção: `users`
- Tipo de gráfico: Column (ou Line)
- Campos: X: `semana` (sem agrupar de novo) · Y: `pessoas` (sum)

```json
[
  {
    "$group": {
      "_id": {
        "$dateTrunc": {
          "date": "$createdAt",
          "unit": "week",
          "timezone": "America/Sao_Paulo",
          "startOfWeek": "monday"
        }
      },
      "pessoas": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "pessoas": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

### Grupos criados por semana

- Coleção: `groups`
- Tipo de gráfico: Column
- Campos: X: `semana` · Y: `grupos` (sum)

```json
[
  {
    "$group": {
      "_id": {
        "$dateTrunc": {
          "date": "$createdAt",
          "unit": "week",
          "timezone": "America/Sao_Paulo",
          "startOfWeek": "monday"
        }
      },
      "grupos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "grupos": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

### Despesas lançadas por semana

- Coleção: `expenses`
- Tipo de gráfico: Column (quantidade) e Line (valor)
- Campos: X: `semana` · Y: `despesas` ou `valorReais` (sum)
- Observação: Fora as despesas fixas, que o sistema cria sozinho a cada mês.

```json
[
  {
    "$match": {
      "recurrence.id": {
        "$exists": false
      }
    }
  },
  {
    "$group": {
      "_id": {
        "$dateTrunc": {
          "date": "$createdAt",
          "unit": "week",
          "timezone": "America/Sao_Paulo",
          "startOfWeek": "monday"
        }
      },
      "despesas": {
        "$sum": 1
      },
      "valorReais": {
        "$sum": {
          "$divide": [
            "$amountCents",
            100
          ]
        }
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "despesas": 1,
      "valorReais": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

## 3. Uso de verdade

### Pessoas ativas por semana

- Coleção: `expenses`
- Tipo de gráfico: Line
- Campos: X: `semana` · Y: `pessoas` (sum)
- Observação: Ativa = lançou uma despesa ou registrou um pagamento naquela semana. Quem só abriu o app não aparece: o banco não guarda visitas.

```json
[
  {
    "$project": {
      "ev": {
        "$concatArrays": [
          {
            "$cond": [
              {
                "$ifNull": [
                  "$recurrence",
                  false
                ]
              },
              [],
              [
                {
                  "uid": "$createdBy",
                  "at": "$createdAt"
                }
              ]
            ]
          },
          {
            "$map": {
              "input": {
                "$ifNull": [
                  "$shares",
                  []
                ]
              },
              "as": "s",
              "in": {
                "uid": "$$s.markedBy",
                "at": "$$s.paidAt"
              }
            }
          },
          {
            "$reduce": {
              "input": {
                "$ifNull": [
                  "$shares",
                  []
                ]
              },
              "initialValue": [],
              "in": {
                "$concatArrays": [
                  "$$value",
                  {
                    "$map": {
                      "input": {
                        "$ifNull": [
                          "$$this.parts",
                          []
                        ]
                      },
                      "as": "p",
                      "in": {
                        "uid": "$$p.markedBy",
                        "at": "$$p.at"
                      }
                    }
                  }
                ]
              }
            }
          }
        ]
      }
    }
  },
  {
    "$unwind": "$ev"
  },
  {
    "$match": {
      "ev.uid": {
        "$type": "string",
        "$ne": ""
      },
      "ev.at": {
        "$type": "date"
      }
    }
  },
  {
    "$group": {
      "_id": {
        "semana": {
          "$dateTrunc": {
            "date": "$ev.at",
            "unit": "week",
            "timezone": "America/Sao_Paulo",
            "startOfWeek": "monday"
          }
        },
        "uid": "$ev.uid"
      }
    }
  },
  {
    "$group": {
      "_id": "$_id.semana",
      "pessoas": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "pessoas": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

### Grupos ativos por semana

- Coleção: `expenses`
- Tipo de gráfico: Line
- Campos: X: `semana` · Y: `grupos` (sum)
- Observação: Ativo = teve despesa lançada por alguém naquela semana.

```json
[
  {
    "$match": {
      "recurrence.id": {
        "$exists": false
      }
    }
  },
  {
    "$group": {
      "_id": {
        "semana": {
          "$dateTrunc": {
            "date": "$createdAt",
            "unit": "week",
            "timezone": "America/Sao_Paulo",
            "startOfWeek": "monday"
          }
        },
        "g": "$groupId"
      }
    }
  },
  {
    "$group": {
      "_id": "$_id.semana",
      "grupos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "grupos": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

### Funil: da conta ao pagamento

- Coleção: `users`
- Tipo de gráfico: Bar (horizontal)
- Campos: Y: `etapa` (ordenar por nome, crescente) · X: `pessoas` (sum)
- Observação: É a consulta mais pesada da lista (três buscas por pessoa). Com a base de hoje roda bem; deixe a atualização do painel em 1 hora ou mais.

```json
[
  {
    "$lookup": {
      "from": "groups",
      "localField": "_id",
      "foreignField": "members.uid",
      "pipeline": [
        {
          "$limit": 1
        },
        {
          "$project": {
            "_id": 1
          }
        }
      ],
      "as": "g"
    }
  },
  {
    "$lookup": {
      "from": "expenses",
      "localField": "_id",
      "foreignField": "paidBy",
      "pipeline": [
        {
          "$limit": 1
        },
        {
          "$project": {
            "_id": 1
          }
        }
      ],
      "as": "e"
    }
  },
  {
    "$lookup": {
      "from": "expenses",
      "localField": "_id",
      "foreignField": "shares.markedBy",
      "pipeline": [
        {
          "$limit": 1
        },
        {
          "$project": {
            "_id": 1
          }
        }
      ],
      "as": "p"
    }
  },
  {
    "$group": {
      "_id": null,
      "contas": {
        "$sum": 1
      },
      "emGrupo": {
        "$sum": {
          "$cond": [
            {
              "$gt": [
                {
                  "$size": "$g"
                },
                0
              ]
            },
            1,
            0
          ]
        }
      },
      "comDespesa": {
        "$sum": {
          "$cond": [
            {
              "$gt": [
                {
                  "$size": "$e"
                },
                0
              ]
            },
            1,
            0
          ]
        }
      },
      "comPagamento": {
        "$sum": {
          "$cond": [
            {
              "$gt": [
                {
                  "$size": "$p"
                },
                0
              ]
            },
            1,
            0
          ]
        }
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "etapas": [
        {
          "etapa": "1. Criou a conta",
          "pessoas": "$contas"
        },
        {
          "etapa": "2. Está em um grupo",
          "pessoas": "$emGrupo"
        },
        {
          "etapa": "3. Tem despesa em seu nome",
          "pessoas": "$comDespesa"
        },
        {
          "etapa": "4. Registrou um pagamento",
          "pessoas": "$comPagamento"
        }
      ]
    }
  },
  {
    "$unwind": "$etapas"
  },
  {
    "$replaceRoot": {
      "newRoot": "$etapas"
    }
  }
]
```

### Tamanho dos grupos

- Coleção: `groups`
- Tipo de gráfico: Column
- Campos: X: `pessoas` (como categoria) · Y: `grupos` (sum)
- Observação: Conta também as pessoas sem celular. Grupo com 1 pessoa é grupo que ninguém convidou ainda.

```json
[
  {
    "$group": {
      "_id": {
        "$size": "$members"
      },
      "grupos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "pessoas": "$_id",
      "grupos": 1
    }
  },
  {
    "$sort": {
      "pessoas": 1
    }
  }
]
```

### Pessoas com chave Pix cadastrada

- Coleção: `users`
- Tipo de gráfico: Donut
- Campos: Label: `tipo` · Arc: `pessoas` (sum)

```json
[
  {
    "$group": {
      "_id": {
        "$cond": [
          {
            "$ifNull": [
              "$pixKey",
              false
            ]
          },
          "Com chave Pix",
          "Sem chave Pix"
        ]
      },
      "pessoas": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "tipo": "$_id",
      "pessoas": 1
    }
  },
  {
    "$sort": {
      "tipo": 1
    }
  }
]
```

## 4. Despesas e pagamentos

### Tipos de despesa

- Coleção: `expenses`
- Tipo de gráfico: Donut
- Campos: Label: `tipo` · Arc: `despesas` (sum)

```json
[
  {
    "$group": {
      "_id": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$ifNull": [
                  "$recurrence",
                  false
                ]
              },
              "then": "Fixa (mês gerado)"
            },
            {
              "case": {
                "$ifNull": [
                  "$installment",
                  false
                ]
              },
              "then": "Parcela"
            },
            {
              "case": {
                "$ifNull": [
                  "$planId",
                  false
                ]
              },
              "then": "Nasceu de um plano"
            }
          ],
          "default": "À vista"
        }
      },
      "despesas": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "tipo": "$_id",
      "despesas": 1
    }
  },
  {
    "$sort": {
      "tipo": 1
    }
  }
]
```

### Quanto já foi pago e quanto falta

- Coleção: `expenses`
- Tipo de gráfico: Donut (ou Number para cada valor)
- Campos: Label: `situacao` · Arc: `valorReais` (sum)
- Observação: Só as partes de quem deve; a parte de quem pagou a despesa fica de fora.

```json
[
  {
    "$unwind": "$shares"
  },
  {
    "$match": {
      "$expr": {
        "$ne": [
          "$shares.uid",
          "$paidBy"
        ]
      }
    }
  },
  {
    "$group": {
      "_id": null,
      "pago": {
        "$sum": {
          "$min": [
            {
              "$ifNull": [
                "$shares.paidCents",
                {
                  "$cond": [
                    {
                      "$eq": [
                        "$shares.status",
                        "paid"
                      ]
                    },
                    "$shares.amountCents",
                    0
                  ]
                }
              ]
            },
            "$shares.amountCents"
          ]
        }
      },
      "falta": {
        "$sum": {
          "$max": [
            0,
            {
              "$subtract": [
                "$shares.amountCents",
                {
                  "$ifNull": [
                    "$shares.paidCents",
                    {
                      "$cond": [
                        {
                          "$eq": [
                            "$shares.status",
                            "paid"
                          ]
                        },
                        "$shares.amountCents",
                        0
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "linhas": [
        {
          "situacao": "Pago",
          "valorReais": {
            "$divide": [
              "$pago",
              100
            ]
          }
        },
        {
          "situacao": "Falta pagar",
          "valorReais": {
            "$divide": [
              "$falta",
              100
            ]
          }
        }
      ]
    }
  },
  {
    "$unwind": "$linhas"
  },
  {
    "$replaceRoot": {
      "newRoot": "$linhas"
    }
  }
]
```

### Quem registra os pagamentos e se tem comprovante

- Coleção: `expenses`
- Tipo de gráfico: Stacked Bar
- Campos: Y: `quem` · X: `pagamentos` (sum) · Series: `comprovante`

```json
[
  {
    "$unwind": "$shares"
  },
  {
    "$project": {
      "pg": {
        "$concatArrays": [
          {
            "$cond": [
              {
                "$ifNull": [
                  "$shares.method",
                  false
                ]
              },
              [
                {
                  "method": "$shares.method",
                  "admin": "$shares.markedByAdmin",
                  "receipt": "$shares.receipt"
                }
              ],
              []
            ]
          },
          {
            "$map": {
              "input": {
                "$ifNull": [
                  "$shares.parts",
                  []
                ]
              },
              "as": "p",
              "in": {
                "method": "$$p.method",
                "admin": "$$p.byAdmin",
                "receipt": "$$p.receipt"
              }
            }
          }
        ]
      }
    }
  },
  {
    "$unwind": "$pg"
  },
  {
    "$group": {
      "_id": {
        "quem": {
          "$switch": {
            "branches": [
              {
                "case": {
                  "$eq": [
                    "$pg.method",
                    "self"
                  ]
                },
                "then": "Quem pagou a parte (Já paguei)"
              },
              {
                "case": {
                  "$eq": [
                    "$pg.admin",
                    true
                  ]
                },
                "then": "Administrador do grupo"
              }
            ],
            "default": "Quem recebeu"
          }
        },
        "comprovante": {
          "$cond": [
            {
              "$ifNull": [
                "$pg.receipt",
                false
              ]
            },
            "Com comprovante",
            "Sem comprovante"
          ]
        }
      },
      "pagamentos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "quem": "$_id.quem",
      "comprovante": "$_id.comprovante",
      "pagamentos": 1
    }
  },
  {
    "$sort": {
      "quem": 1,
      "comprovante": 1
    }
  }
]
```

## 5. Planos

### Planos por situação

- Coleção: `plans`
- Tipo de gráfico: Donut
- Campos: Label: `tipo` · Arc: `planos` (sum)

```json
[
  {
    "$group": {
      "_id": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$eq": [
                  "$status",
                  "open"
                ]
              },
              "then": "Aberto"
            },
            {
              "case": {
                "$eq": [
                  "$status",
                  "cancelled"
                ]
              },
              "then": "Cancelado"
            },
            {
              "case": {
                "$and": [
                  {
                    "$eq": [
                      "$status",
                      "done"
                    ]
                  },
                  {
                    "$ifNull": [
                      "$expenseId",
                      false
                    ]
                  }
                ]
              },
              "then": "Virou grupo e despesa"
            },
            {
              "case": {
                "$eq": [
                  "$status",
                  "done"
                ]
              },
              "then": "Virou só o grupo"
            }
          ],
          "default": "Fechando agora"
        }
      },
      "planos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "tipo": "$_id",
      "planos": 1
    }
  },
  {
    "$sort": {
      "tipo": 1
    }
  }
]
```

### Respostas nos planos

- Coleção: `plans`
- Tipo de gráfico: Donut
- Campos: Label: `tipo` · Arc: `respostas` (sum)
- Observação: Só a contagem; o valor do limite de cada pessoa não entra em gráfico nenhum.

```json
[
  {
    "$unwind": "$responses"
  },
  {
    "$group": {
      "_id": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$ne": [
                  "$responses.going",
                  true
                ]
              },
              "then": "Não vou"
            },
            {
              "case": {
                "$ifNull": [
                  "$responses.limitCents",
                  false
                ]
              },
              "then": "Vou, com limite"
            }
          ],
          "default": "Vou, sem limite"
        }
      },
      "respostas": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "tipo": "$_id",
      "respostas": 1
    }
  },
  {
    "$sort": {
      "tipo": 1
    }
  }
]
```

## 6. Avisos

### Avisos gerados por semana

- Coleção: `inbox`
- Tipo de gráfico: Column
- Campos: X: `semana` · Y: `avisos` (sum)
- Observação: A coleção guarda só os últimos 90 dias.

```json
[
  {
    "$group": {
      "_id": {
        "$dateTrunc": {
          "date": "$createdAt",
          "unit": "week",
          "timezone": "America/Sao_Paulo",
          "startOfWeek": "monday"
        }
      },
      "avisos": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "semana": "$_id",
      "avisos": 1
    }
  },
  {
    "$sort": {
      "semana": 1
    }
  }
]
```

### Lembretes de vencimento por dia

- Coleção: `reminder_log`
- Tipo de gráfico: Stacked Column
- Campos: X: `dia` · Y: `lembretes` (sum) · Series: `antecedencia`
- Observação: A coleção guarda só os últimos 120 dias.

```json
[
  {
    "$group": {
      "_id": {
        "dia": {
          "$dateTrunc": {
            "date": "$createdAt",
            "unit": "day",
            "timezone": "America/Sao_Paulo"
          }
        },
        "lead": "$lead"
      },
      "lembretes": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "dia": "$_id.dia",
      "antecedencia": {
        "$cond": [
          {
            "$eq": [
              "$_id.lead",
              0
            ]
          },
          "No dia",
          {
            "$concat": [
              {
                "$toString": "$_id.lead"
              },
              " dias antes"
            ]
          }
        ]
      },
      "lembretes": 1
    }
  },
  {
    "$sort": {
      "dia": 1
    }
  }
]
```

