# Public data contract

All money values are USD unless an asset or EUR is explicitly named. Weights and drawdowns are fractions: `0.15` means 15%, `-0.1` means a 10% drawdown. Dates are ISO UTC; the interface formats them in Europe/Rome with CET or CEST. Nullable fields are unavailable, never zero substitutes.

The JSON Schema 2020-12 document below defines every public file. To validate a file, add the matching `$ref` to the schema root:

| File | Root reference |
| --- | --- |
| `site/data/treasury.json` | `#/$defs/treasury` |
| `site/data/prices.json` | `#/$defs/prices` |
| `site/data/nav-history.json` | `#/$defs/nav-history` |
| `site/data/sources.json` | `#/$defs/sources` |
| `site/data/decisions.json` | `#/$defs/decisions` |
| `site/data/valuation.json` | `#/$defs/valuation` |
| `site/data/audits.json` | `#/$defs/audits` |

`generatedAt` records the refresh attempt; `updatedAt` records the applicable data date. Source `lastSuccessAt` is null for unverified seeds. A failed source is stale when previously successful values remain, or error when only initial estimates or no usable values remain. Initial files use stale with note `seed`. Partial quotes keep their original dates. Dated safety assessments become stale after 30 days; the decision feed becomes stale after one day without a published outcome.

NAV includes full venue values across Avalanche, Hyperliquid, Polymarket (positions marked at current outcome prices plus pUSD cash), Avantis and YO vaults (redeem preview, net of withdrawal fees), and native plus major stable balances on Base, Polygon, Ethereum, Arbitrum, Optimism and BNB Chain, including holdings below the $0.01 display threshold. Hyperliquid account value already includes open-position profit and loss; open positions must not be added to NAV again. The initial AVAX value is a residual estimate, with a null position price. The separate initial AVAX market quote is approximate and does not imply a reconciled position value.

Drawdown is measured on managed NAV: the full NAV minus open prediction-market positions, with prediction-market cash kept in. Its peak is tracked separately from the full-NAV history, starting 18 Oct 2026; earlier points without a managed value are ignored. Managed NAV is the single basis for position weights, the sAVAX cap, satellite caps, tier sizes and drawdown. The headline `nav` is total holdings, including open prediction-market positions, which carry weight 0 and `inManagedNav: false`. The 7-day drawdown needs at least two recent points and seven days of coverage. Peak drawdown needs at least two points; the all-time high is retained separately in treasury even as history is compacted. Execution pauses at or below -10% over seven days; the escalation flag is set at or below -25% from peak. Drawdown alone does not prove that trades are running.

History is bucketed to the last point of each quarter-hour, then to the last point per UTC day beyond 30 days. The hard 2,000-entry ceiling retains the highest sampled point and the newest points. Thirty days at 15-minute intervals needs 2,880 entries, so the ceiling necessarily shortens full-resolution coverage. A wholly failed refresh creates no new history point; a partially refreshed valuation may use dated fallback values and is marked estimated.

Valuation fields describe the dated research snapshot. `modeledValue` is its base present value, `buyLevel` its stressed admission ceiling, and `marginOfSafety` its original discount to base value. Gates are published research outputs, not automatically reapproved when prices change. The price table carries independent quote dates. The `token` field is the required asset symbol, not authentication material. Unknown p33 market mapping is left unmapped; its dated research quote remains available.

## Schemas

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Public Mony data definitions. Select the definition matching the filename without its extension.",
  "$defs": {
    "balance": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "balance": {
          "type": "number",
          "minimum": 0
        },
        "decimals": {
          "type": "integer",
          "minimum": 0,
          "maximum": 255
        }
      },
      "required": [
        "asset",
        "balance",
        "decimals"
      ]
    },
    "spotBalance": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "balance": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "asset",
        "balance"
      ]
    },
    "openPosition": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "balance": {
          "type": "number"
        },
        "entryPrice": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "positionValue": {
          "type": "number",
          "minimum": 0
        },
        "unrealizedPnl": {
          "type": "number"
        },
        "marginUsed": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "asset",
        "balance",
        "entryPrice",
        "positionValue",
        "unrealizedPnl",
        "marginUsed"
      ]
    },
    "position": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "venue": {
          "enum": [
            "Avalanche",
            "Hyperliquid margin",
            "Hyperliquid spot",
            "Polymarket",
            "Avantis",
            "YO",
            "Base",
            "Polygon",
            "Ethereum",
            "Arbitrum",
            "Optimism",
            "BNB Chain"
          ]
        },
        "balance": {
          "type": "number"
        },
        "priceUsd": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "valueUsd": {
          "type": "number"
        },
        "weight": {
          "type": "number"
        },
        "inManagedNav": {
          "const": false,
          "description": "Present on open prediction-market positions, which are excluded from managed NAV and carry weight 0."
        }
      },
      "required": [
        "asset",
        "venue",
        "balance",
        "priceUsd",
        "valueUsd",
        "weight"
      ]
    },
    "sAVAX": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "weight": {
          "type": "number"
        },
        "cap": {
          "const": 0.15
        },
        "overCap": {
          "type": "boolean"
        },
        "excessUsd": {
          "type": "number",
          "minimum": 0
        },
        "trimAmount": {
          "type": "number",
          "minimum": 0
        },
        "trimmedAmount": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "weight",
        "cap",
        "overCap",
        "excessUsd",
        "trimAmount",
        "trimmedAmount"
      ]
    },
    "satellites": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "weight": {
          "type": "number"
        },
        "capEach": {
          "const": 0.1
        },
        "capCombined": {
          "const": 0.4
        },
        "overCap": {
          "type": "boolean"
        },
        "assets": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "asset": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
              },
              "valueUsd": {
                "type": "number",
                "minimum": 0
              },
              "weight": {
                "type": "number"
              },
              "overCap": {
                "type": "boolean"
              }
            },
            "required": [
              "asset",
              "valueUsd",
              "weight",
              "overCap"
            ]
          }
        }
      },
      "required": [
        "weight",
        "capEach",
        "capCombined",
        "overCap",
        "assets"
      ]
    },
    "drawdown": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "sevenDay": {
          "type": [
            "number",
            "null"
          ]
        },
        "fromPeak": {
          "type": [
            "number",
            "null"
          ]
        },
        "peakNav": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "pauseThreshold": {
          "const": -0.1
        },
        "escalateThreshold": {
          "const": -0.25
        },
        "basis": {
          "const": "managed"
        },
        "managedNav": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "sevenDay",
        "fromPeak",
        "peakNav",
        "pauseThreshold",
        "escalateThreshold"
      ]
    },
    "treasury": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "wallet": {
          "type": "string",
          "pattern": "^0x[0-9a-fA-F]{40}$"
        },
        "currency": {
          "const": "USD"
        },
        "estimated": {
          "type": "boolean"
        },
        "note": {
          "type": "string",
          "maxLength": 400
        },
        "nav": {
          "type": "number",
          "minimum": 0
        },
        "venues": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "avalanche": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "valueUsd": {
                  "type": "number",
                  "minimum": 0
                },
                "updatedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                }
              },
              "required": [
                "valueUsd",
                "updatedAt"
              ]
            },
            "hyperliquid": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "valueUsd": {
                  "type": "number"
                },
                "updatedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "accountValue": {
                  "type": "number"
                },
                "withdrawable": {
                  "type": "number",
                  "minimum": 0
                },
                "spotBalances": {
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/spotBalance"
                  }
                },
                "assetPositions": {
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/openPosition"
                  }
                }
              },
              "required": [
                "valueUsd",
                "updatedAt",
                "accountValue",
                "withdrawable",
                "spotBalances",
                "assetPositions"
              ]
            },
            "polymarket": {
              "$ref": "#/$defs/extraVenue"
            },
            "avantis": {
              "$ref": "#/$defs/extraVenue"
            },
            "yo": {
              "$ref": "#/$defs/extraVenue"
            },
            "base": {
              "$ref": "#/$defs/extraVenue"
            },
            "polygon": {
              "$ref": "#/$defs/extraVenue"
            },
            "ethereum": {
              "$ref": "#/$defs/extraVenue"
            },
            "arbitrum": {
              "$ref": "#/$defs/extraVenue"
            },
            "optimism": {
              "$ref": "#/$defs/extraVenue"
            },
            "bnb": {
              "$ref": "#/$defs/extraVenue"
            }
          },
          "required": [
            "avalanche",
            "hyperliquid"
          ]
        },
        "avalancheBalances": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/balance"
          }
        },
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/position"
          }
        },
        "allocation": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "sAVAX": {
              "$ref": "#/$defs/sAVAX"
            },
            "satellites": {
              "$ref": "#/$defs/satellites"
            },
            "external": {
              "type": "object",
              "description": "Positions outside the trading mandate (Polymarket, Avantis, YO): counted in NAV and weights, excluded from satellite caps.",
              "additionalProperties": false,
              "properties": {
                "weight": {
                  "type": "number"
                },
                "venues": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "venue": {
                        "type": "string"
                      },
                      "valueUsd": {
                        "type": "number"
                      },
                      "weight": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "venue",
                      "valueUsd",
                      "weight"
                    ]
                  }
                }
              },
              "required": [
                "weight",
                "venues"
              ]
            },
            "basis": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "kind": {
                  "const": "managed"
                },
                "valueUsd": {
                  "type": "number",
                  "minimum": 0
                }
              },
              "required": [
                "kind",
                "valueUsd"
              ]
            },
            "tiers": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "t1Usd": {
                  "type": "number",
                  "minimum": 0
                },
                "t2Usd": {
                  "type": "number",
                  "minimum": 0
                },
                "note": {
                  "type": "string"
                }
              },
              "required": [
                "t1Usd",
                "t2Usd",
                "note"
              ]
            }
          },
          "required": [
            "sAVAX",
            "satellites"
          ]
        },
        "drawdown": {
          "$ref": "#/$defs/drawdown"
        },
        "execution": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "status": {
              "enum": [
                "active",
                "paused"
              ]
            },
            "escalated": {
              "type": "boolean"
            }
          },
          "required": [
            "status",
            "escalated"
          ]
        },
        "gasAvax": {
          "type": "number",
          "minimum": 0
        },
        "managedNav": {
          "type": "number",
          "minimum": 0,
          "description": "Full NAV minus open prediction-market positions; prediction-market cash stays in. Single basis for weights, the sAVAX cap, tier sizes and drawdown."
        }
      },
      "required": [
        "generatedAt",
        "updatedAt",
        "wallet",
        "currency",
        "estimated",
        "note",
        "nav",
        "venues",
        "avalancheBalances",
        "positions",
        "allocation",
        "drawdown",
        "execution",
        "gasAvax"
      ]
    },
    "quote": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "priceUsd": {
          "type": "number",
          "minimum": 0
        },
        "change24h": {
          "type": [
            "number",
            "null"
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "source": {
          "enum": [
            "CoinGecko",
            "Hyperliquid",
            "Research",
            "Snapshot"
          ]
        }
      },
      "required": [
        "priceUsd",
        "change24h",
        "updatedAt",
        "source"
      ]
    },
    "prices": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "prices": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/quote"
          }
        }
      },
      "required": [
        "generatedAt",
        "updatedAt",
        "prices"
      ]
    },
    "nav-history": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "t": {
            "type": "string",
            "format": "date-time"
          },
          "nav": {
            "type": "number",
            "minimum": 0
          },
          "managed": {
            "type": "number",
            "minimum": 0,
            "description": "Managed NAV; present from 18 Oct 2026."
          }
        },
        "required": [
          "t",
          "nav"
        ]
      },
      "maxItems": 2000
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": {
          "enum": [
            "ok",
            "stale",
            "error"
          ]
        },
        "updatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "lastSuccessAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "note": {
          "type": "string",
          "maxLength": 400
        }
      },
      "required": [
        "status",
        "updatedAt",
        "lastSuccessAt",
        "note"
      ]
    },
    "sources": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sources": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "avalanche_rpc": {
              "$ref": "#/$defs/source"
            },
            "hyperliquid": {
              "$ref": "#/$defs/source"
            },
            "coingecko": {
              "$ref": "#/$defs/source"
            },
            "serialized_audit": {
              "$ref": "#/$defs/source"
            },
            "decisions": {
              "$ref": "#/$defs/source"
            },
            "polymarket": {
              "$ref": "#/$defs/source"
            },
            "avantis": {
              "$ref": "#/$defs/source"
            },
            "yo": {
              "$ref": "#/$defs/source"
            },
            "evm_wallets": {
              "$ref": "#/$defs/source"
            }
          },
          "required": [
            "avalanche_rpc",
            "hyperliquid",
            "coingecko",
            "serialized_audit",
            "decisions"
          ]
        }
      },
      "required": [
        "generatedAt",
        "sources"
      ]
    },
    "size": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": "number",
          "minimum": 0
        },
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "usd": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "amount",
        "asset"
      ]
    },
    "received": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": "number",
          "minimum": 0
        },
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        }
      },
      "required": [
        "amount",
        "asset"
      ]
    },
    "transaction": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "label": {
          "enum": [
            "approve",
            "swap",
            "transfer"
          ]
        },
        "hash": {
          "type": "string",
          "pattern": "^0x[0-9a-fA-F]{64}$"
        },
        "block": {
          "type": "integer",
          "minimum": 0
        },
        "gasUsed": {
          "type": "integer",
          "minimum": 0
        },
        "gasAvax": {
          "type": "number",
          "minimum": 0
        }
      },
      "required": [
        "label",
        "hash"
      ]
    },
    "decision": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          "maxLength": 100
        },
        "date": {
          "type": "string",
          "format": "date-time"
        },
        "outcome": {
          "enum": [
            "execute",
            "no_op",
            "blocked",
            "escalated"
          ]
        },
        "title": {
          "type": "string",
          "maxLength": 100
        },
        "reason": {
          "type": "string",
          "maxLength": 280
        },
        "asset": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "action": {
          "enum": [
            "trim",
            "buy",
            "sell",
            "rebalance",
            "none"
          ]
        },
        "size": {
          "$ref": "#/$defs/size"
        },
        "received": {
          "$ref": "#/$defs/received"
        },
        "txs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/transaction"
          },
          "maxItems": 20
        },
        "trim": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "completedAmount": {
              "type": "number",
              "minimum": 0
            },
            "asset": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
            },
            "targetWeight": {
              "const": 0.15
            }
          },
          "required": [
            "completedAmount",
            "asset",
            "targetWeight"
          ]
        }
      },
      "required": [
        "id",
        "date",
        "outcome",
        "title",
        "reason",
        "asset",
        "action",
        "size"
      ]
    },
    "decisions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "decisions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/decision"
          },
          "maxItems": 500
        }
      },
      "required": [
        "updatedAt",
        "decisions"
      ]
    },
    "valuationRow": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "priceUsd": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "priceAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "modeledValue": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "buyLevel": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "marginOfSafety": {
          "type": [
            "number",
            "null"
          ]
        },
        "gatePass": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "note": {
          "type": "string",
          "maxLength": 280
        }
      },
      "required": [
        "token",
        "priceUsd",
        "priceAt",
        "modeledValue",
        "buyLevel",
        "marginOfSafety",
        "gatePass",
        "note"
      ]
    },
    "valuation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/valuationRow"
          },
          "maxItems": 100
        }
      },
      "required": [
        "updatedAt",
        "rows"
      ]
    },
    "auditRow": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,23}$"
        },
        "isSafe": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "createdAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "assessment": {
          "type": "string",
          "maxLength": 200
        }
      },
      "required": [
        "token",
        "isSafe",
        "createdAt",
        "assessment"
      ]
    },
    "audits": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/auditRow"
          },
          "maxItems": 100
        }
      },
      "required": [
        "updatedAt",
        "rows"
      ]
    },
    "extraVenue": {
      "type": "object",
      "description": "Venue outside Avalanche and Hyperliquid. Polymarket, Avantis and YO add protocol detail fields; chain wallets add balances.",
      "properties": {
        "label": {
          "type": "string"
        },
        "valueUsd": {
          "type": "number",
          "minimum": 0
        },
        "updatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "chain": {
          "type": "string"
        },
        "balances": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/balance"
          }
        }
      },
      "required": [
        "label",
        "valueUsd",
        "updatedAt"
      ]
    }
  }
}
```

## Publishing a decision

The following complete entry is the initial public execution record:

```json
{
  "id": "2026-10-17-savax-trim-1",
  "date": "2026-10-17T16:41:00.000Z",
  "outcome": "execute",
  "title": "sAVAX trim, tranche 1",
  "reason": "Trimmed sAVAX into WAVAX to reduce concentration above the 15% cap while keeping AVAX exposure.",
  "asset": "sAVAX",
  "action": "trim",
  "size": {
    "amount": 0.55,
    "asset": "sAVAX",
    "usd": 6.98
  },
  "received": {
    "amount": 0.7097,
    "asset": "WAVAX"
  },
  "txs": [
    {
      "label": "approve",
      "hash": "0x390aac82074fedf420f8c45ce74905a019da0d88be263cfa4eb4022d5f976dbb",
      "block": 97809002,
      "gasUsed": 55839,
      "gasAvax": 0.000335034
    },
    {
      "label": "swap",
      "hash": "0x3dc1541819b4e4c05aeeb34216fea419fe3c69d18450f0c4cdc9bbcc0de06abe",
      "block": 97809086,
      "gasUsed": 383647,
      "gasAvax": 0.002301882
    }
  ],
  "trim": {
    "completedAmount": 0.55,
    "asset": "sAVAX",
    "targetWeight": 0.15
  }
}
```

Save one record as `decision.json`, then preview and append it:

```sh
node tools/publish-ops.mjs --dry-run decision.json
node tools/publish-ops.mjs decision.json
cat decision.json | node tools/publish-ops.mjs -
```

The publisher keeps only the fields above, recursively, upserts by `id`, sorts newest first, and caps the feed at 500. Text is normalized and length-limited. Invalid dates, amounts, categories and transaction hashes are rejected. An unsafe input never changes the public file and is not echoed in error output. Existing records are sanitized again when upserting.

Unknown fields such as `nonce`, `signature`, `intent`, `approval`, `signer`, `verifier`, `pubkey`, `caps`, `slippageBps`, paths and secrets are stripped. Remaining strings containing private terminology, file locations, internal addresses, Notion links or a transaction-length hash outside `txs[].hash` are rejected. Source code, raw research and raw receipts are never published.

The same tool replaces valuation and audit envelopes through their own allowlists:

```sh
node tools/publish-ops.mjs --valuation valuation.json --dry-run
node tools/publish-ops.mjs --valuation valuation.json
node tools/publish-ops.mjs --audits audits.json --dry-run
node tools/publish-ops.mjs --audits audits.json
```

The research modes expect `{ "updatedAt": "ISO UTC date", "rows": [...] }`, not a raw provider response. Each asset appears at most once. A missing audit verdict uses `isSafe: null` and `createdAt: null`.
