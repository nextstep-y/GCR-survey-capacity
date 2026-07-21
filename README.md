# GCR Inspector Capacity Dashboard

Local web dashboard for the daily GCR Viber survey capacity Google Sheet.

## Run

```bash
node server.mjs
```

Then open:

```text
http://localhost:4173
```

The server proxies Google Sheet CSV tabs from:

```text
1ZaIHyL6iMFXmlYQoZHfQNdVRFU6Jy83dYgYqyASt3Q4
```

Override with:

```bash
GCR_SHEET_ID=<spreadsheet-id> PORT=4173 node server.mjs
```
