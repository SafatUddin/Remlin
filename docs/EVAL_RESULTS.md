# AI Agent Evaluation Results

Generated: 2026-11-09T23:10:48.030Z
Model path: Gemini (live)
Total cases: 50

## Overall metrics

- **Intent accuracy**: 49/50 (98.0%)
- **SKU accuracy** (cases with an expected product): 34/34 (100.0%)
- **Complaint precision**: 88.9% (TP=8, FP=1)
- **Complaint recall**: 100.0% (TP=8, FN=0)

## By category

| Category | Cases | Intent correct | Accuracy |
|---|---|---|---|
| price | 10 | 10 | 100.0% |
| stock | 8 | 8 | 100.0% |
| buy_no_qty | 8 | 7 | 87.5% |
| buy_with_qty | 8 | 8 | 100.0% |
| complaint | 8 | 8 | 100.0% |
| chitchat | 8 | 8 | 100.0% |

## By language

| Language | Cases | Intent correct | Accuracy |
|---|---|---|---|
| en | 24 | 24 | 100.0% |
| bn | 10 | 9 | 90.0% |
| banglish | 16 | 16 | 100.0% |

## Missed cases

| Case | Category/Lang | Message | Expected SKU | Predicted SKU | isComplaint | Reply |
|---|---|---|---|---|---|---|
| buyq-05 | buy_no_qty/bn | আমি একটা t-shirt কিনতে চাই | TSHIRT-01 | TSHIRT-01 | false | Premium Cotton T-Shirt এর দাম 12.99। আপনি কয়টি টি-শার্ট নিতে চান? |
