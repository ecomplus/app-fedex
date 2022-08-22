const Axios = require('./create-axios')
const auth = require('./create-auth')
// typeScope ===  card, if scope card_tokenization
// typeScope === transaction, if scope for transaction

const firestoreColl = 'fedex_tokens'

const AxiosOrToken = (resolve, reject, clienId, clientSecret, isSandbox, storeId, self) => {

  let documentRef
  if (firestoreColl) {
    documentRef = require('firebase-admin')
      .firestore()
      .doc(`${firestoreColl}/${storeId}`)
  }

  const authenticate = (accessToken, resolve) => {
    if (self) {
      const axios = Axios(accessToken, isSandbox)
      resolve(axios)
    } else {
      resolve(accessToken)
    }
  }

  const handleAuth = (resolve) => {
    console.log('> Fedex Auth ', storeId)
    auth(clienId, clientSecret, storeId, isSandbox)
      .then((resp) => {
        authenticate(resp.access_token, resolve)
        if (documentRef) {
          documentRef.set({ ...resp, isSandbox }).catch(console.error)
        }
      })
      .catch(reject)
  }

  if (documentRef) {
    documentRef.get()
      .then((documentSnapshot) => {
        const data = documentSnapshot.data() || null
        if (documentSnapshot.exists &&
          Date.now() - documentSnapshot.updateTime.toDate().getTime() <= 50 * 60 * 1000 // access token expires in 50 minutes
        ) {
          authenticate(data.access_token, resolve)
        } else {
          handleAuth(resolve)
        }
      })
      .catch(console.error)
  } else {
    handleAuth(resolve)
  }
}

const CreateAxios = (clienId, clientSecret, isSandbox, storeId) => {
  return new Promise((resolve, reject) => {
    AxiosOrToken(resolve, reject, clienId, clientSecret, isSandbox, storeId, this)
  })
}

const getToken = (clienId, clientSecret, isSandbox, storeId) => {
  return new Promise((resolve, reject) => {
    AxiosOrToken(resolve, reject, clienId, clientSecret, isSandbox, storeId)
  })
}

module.exports = {
  CreateAxios,
  getToken
}
