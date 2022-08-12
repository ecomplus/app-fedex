const axios = require('axios')
module.exports = (accessToken, isSandbox) => {
  // https://docs.galaxpay.com.br/autenticacao
  // https://docs.galaxpay.com.br/auth/token

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
  if (accessToken) {
    console.log('> token ', accessToken)
    headers.Authorization = `Bearer ${accessToken}`
  }

  return axios.create({
    //baseURL: 'https://api.galaxpay.com.br/v2',
    baseURL: `https://apis.${isSandbox ? 'sandbox.' : ''}fedex.com`,
    headers
  })
}
