# Modelos de idioma do Tesseract (OCR local — Passo 13)

`por.traineddata.gz` é o modelo de **português** do Tesseract (dados oficiais do
Tesseract, a versão usada pelo tesseract.js), vendorizado aqui para o OCR rodar 100%
no nosso ambiente **sem baixar de CDN em runtime** (coerente com a decisão de sigilo
LGPD/OAB — o documento nunca sai, e o app não depende de rede externa para o modelo).

- Origem: dados oficiais do Tesseract OCR (Apache-2.0) —
  https://github.com/tesseract-ocr/tessdata
- O adapter (`src/adapters/ocr/tesseract-ocr.ts`) aponta `langPath` para esta pasta
  (`OCR_TESSDATA_DIR`, default `vendor/tessdata`) e usa o core/worker locais do
  pacote `tesseract.js` — nenhuma chamada externa.
