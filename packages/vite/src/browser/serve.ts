import { createServer } from './server'

async function serve() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  })

  let template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + TS</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`

  template = await vite.transformIndexHtml('/', template)

  console.log(template)
}

serve()
