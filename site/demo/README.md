# Landing demo

`shipping-spec.md` and `shipping.js` are the inputs shown in the landing-page Rejudge recording. `rejudge-demo.original.cast` keeps the unaccelerated run for inspection.

The public recording keeps the command and final answer at normal speed and accelerates the model wait:

```bash
cp site/demo/rejudge-demo.original.cast site/public/rejudge-demo.cast
bun site/scripts/accelerate-cast.ts site/public/rejudge-demo.cast 5 312 20
```

Before committing either cast, keep only `"command":"rejudge"` in its metadata and normalize local workspace fragments in progress rows to paths relative to `site/demo/`.
