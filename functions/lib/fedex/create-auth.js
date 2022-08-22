module.exports = (clienId, clientSecret, storeId, isSandbox) => new Promise((resolve, reject) => {
  //  https://developer.fedex.com/api/en-in/catalog/authorization/docs.html#operation/API%20Authorization
  let accessToken
  const axios = require('./create-axios')(accessToken, isSandbox)
  const request = isRetry => {
    console.log(`>> Create Auth s:${storeId}--Sandbox: ${isSandbox}`)
    const data = `grant_type=client_credentials&client_id=${clienId}&client_secret=${clientSecret}`
    axios.post('/oauth/token', 
    data
)
      .then(({ data }) => resolve(data))
      .catch(err => {
        console.log('Deu erro', err.message)
        console.log('Deu erro quero response status', err.response.status)
        if (!isRetry && err.response && err.response.status >= 429) {
          setTimeout(() => request(true), 7000)
        }
        reject(err)
      })
  }
  request()
})
