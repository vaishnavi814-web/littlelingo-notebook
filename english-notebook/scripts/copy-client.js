const fs = require('fs')
const path = require('path')

fs.cpSync(path.resolve('client/dist'), path.resolve('server/public'), {
  recursive: true,
})
