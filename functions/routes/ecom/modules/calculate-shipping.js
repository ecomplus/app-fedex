const axios = require('axios')
const { getToken } = require('../../../lib/fedex/create-access')
const { parseShippingSort, parsePickupType } = require('../../../lib/fedex/parse-to-ecom')

exports.post = async ({ appSdk }, req, res) => {
  /**
   * Treat `params` and (optionally) `application` from request body to properly mount the `response`.
   * JSON Schema reference for Calculate Shipping module objects:
   * `params`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/schema.json?store_id=100
   * `response`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/response_schema.json?store_id=100
   *
   * Examples in published apps:
   * https://github.com/ecomplus/app-mandabem/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-datafrete/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-jadlog/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   */

  const { params, application } = req.body
  const { storeId } = req
  // setup basic required response object
  const response = {
    shipping_services: []
  }
  // merge all app options configured by merchant
  const appData = Object.assign({}, application.data, application.hidden_data)

  const { api_key, api_secret } = appData
  if (!api_key && !api_secret) {
    // must have configured kangu doc number and token
    return res.status(409).send({
      error: 'CALCULATE_AUTH_ERR',
      message: 'Credentials are unset on app hidden data (merchant must configure the app)'
    })
  }
  const { isSandbox } = appData
  const accessToken = await getToken(api_key, api_secret, isSandbox, storeId)

  if (appData.free_shipping_from_value >= 0) {
    response.free_shipping_from_value = appData.free_shipping_from_value
  }

  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
  const originZip = params.from
    ? params.from.zip.replace(/\D/g, '')
    : appData.zip ? appData.zip.replace(/\D/g, '') : ''
  
  const { currency, countryCode, taxes, rateSortOrder, pickupType, accountNumber } = appData

  const pickup = parsePickupType(pickupType)
  const sort = parseShippingSort(rateSortOrder)

  if (!params.to) {
    // just a free shipping preview with no shipping address received
    // respond only with free shipping option
    res.send(response)
    return
  }

  /* DO THE STUFF HERE TO FILL RESPONSE OBJECT WITH SHIPPING SERVICES */
  if (!originZip) {
    // must have configured origin zip code to continue
    return res.status(409).send({
      error: 'CALCULATE_ERR',
      message: 'Zip code is unset on app hidden data (merchant must configure the app)'
    })
  }

  if (params.items) {
    let finalWeight = 0
    let cartSubtotal = 0
    const commodities = []
    params.items.forEach((item) => {
      const { name, quantity, weight } = item
      let physicalWeight = 0
      // sum physical weight
      if (weight && weight.value) {
        switch (weight.unit) {
          case 'kg':
            physicalWeight = weight.value
            break
          case 'g':
            physicalWeight = weight.value / 1000
            break
          case 'mg':
            physicalWeight = weight.value / 1000000
        }
      }
      finalWeight += (quantity * physicalWeight)
      cartSubtotal += (quantity * ecomUtils.price(item))
      const unitPrice = {}
      const weightObject = {}
      unitPrice.amount = item.final_price || item.price
      unitPrice.currency = item.currency_id
      weightObject.units = 'KG'
      weightObject.value = physicalWeight


      commodities.push({
        weight: weightObject,
        unitPrice,
        quantity,
        name
      })
    })

    const requestedShipment = {}
    requestedShipment.shipper = {
      address: {
        postalCode: originZip,
        countryCode
      }
    }
    requestedShipment.recipient = {
      address: {
        postalCode: destinationZip,
        countryCode: params.to && params.to.country_code
      }
    }
    requestedShipment.preferredCurrency = currency
    requestedShipment.rateRequestType = ["LIST","PREFERRED","ACCOUNT"]
    requestedShipment.pickupType = pickup
    requestedShipment.edtRequestType = taxes ? 'ALL' : 'NONE'

    const body = {
      cepOrigem: originZip,
      cepDestino: destinationZip,
      customsClearanceDetail: commodities,
      origem: 'E-Com Plus',
      servicos: [
        'E',
        'X',
        'R'
      ],
      ordernar,
      produtos
    }
    // send POST request to kangu REST API
    return axios.post(
      'https://portal.kangu.com.br/tms/transporte/simular',
      body,
      {
        headers: {
          token,
          accept: 'application/json',
          'Content-Type': 'application/json'
        }
      }
    )

      .then(({ data, status }) => {
        let result
        if (typeof data === 'string') {
          try {
            result = JSON.parse(data)
          } catch (e) {
            console.log('> kangu invalid JSON response')
            return res.status(409).send({
              error: 'CALCULATE_INVALID_RES',
              message: data
            })
          }
        } else {
          result = data
        }

        if (result && Number(status) === 200 && Array.isArray(result)) {
          // success response
          let lowestPriceShipping
          result.forEach(kanguService => {
            // parse to E-Com Plus shipping line object
            const serviceCode = String(kanguService.servico)
            const price = kanguService.vlrFrete
            const kanguPickup = Array.isArray(kanguService.pontosRetira)
              ? kanguService.pontosRetira[0]
              : false

            // push shipping service object to response
            const shippingLine = {
              from: {
                ...params.from,
                ...appData.from,
                zip: originZip
              },
              to: params.to,
              price,
              total_price: price,
              discount: 0,
              delivery_time: {
                days: parseInt(kanguService.prazoEnt, 10),
                working_days: true
              },
              delivery_instructions: kanguPickup
                ? `${kanguPickup.nome} - ${completeAddress(kanguPickup.endereco)}`
                : undefined,
              posting_deadline: {
                days: 3,
                ...appData.posting_deadline
              },
              package: {
                weight: {
                  value: finalWeight,
                  unit: 'kg'
                }
              },
              custom_fields: [
                {
                  field: 'kangu_reference',
                  value: kanguPickup
                    ? String(kanguPickup.referencia)
                    : String(kanguService.referencia)
                },
                {
                  field: 'nfe_required',
                  value: kanguService.nf_obrig === 'N' ? 'false' : 'true'
                }
              ],
              flags: ['kangu-ws', `kangu-${serviceCode}`.substr(0, 20)]
            }
            if (!lowestPriceShipping || lowestPriceShipping.price > price) {
              lowestPriceShipping = shippingLine
            }

            // check for default configured additional/discount price
            if (appData.additional_price) {
              if (appData.additional_price > 0) {
                shippingLine.other_additionals = [{
                  tag: 'additional_price',
                  label: 'Adicional padrão',
                  price: appData.additional_price
                }]
              } else {
                // negative additional price to apply discount
                shippingLine.discount -= appData.additional_price
              }
              // update total price
              shippingLine.total_price += appData.additional_price
            }

            // search for discount by shipping rule
            const shippingName = kanguService.transp_nome || kanguService.descricao
            if (Array.isArray(shippingRules)) {
              for (let i = 0; i < shippingRules.length; i++) {
                const rule = shippingRules[i]
                if (
                  rule &&
                  matchService(rule, shippingName) &&
                  checkZipCode(rule) &&
                  !(rule.min_amount > params.subtotal)
                ) {
                  // valid shipping rule
                  if (rule.discount && rule.service_name) {
                    let discountValue = rule.discount.value
                    if (rule.discount.percentage) {
                      discountValue *= (shippingLine.total_price / 100)
                    }
                    shippingLine.discount += discountValue
                    shippingLine.total_price -= discountValue
                    if (shippingLine.total_price < 0) {
                      shippingLine.total_price = 0
                    }
                    break
                  }
                }
              }
            }

            // change label
            let label = shippingName
            if (appData.services && Array.isArray(appData.services) && appData.services.length) {
              const service = appData.services.find(service => {
                return service && matchService(service, label)
              })
              if (service && service.label) {
                label = service.label
              }
            }

            response.shipping_services.push({
              label,
              carrier: kanguService.transp_nome,
              carrier_doc_number: typeof kanguService.cnpjTransp === 'string'
                ? kanguService.cnpjTransp.replace(/\D/g, '').substr(0, 19)
                : undefined,
              service_name: `${(kanguService.descricao || serviceCode)} (Kangu)`,
              service_code: serviceCode,
              shipping_line: shippingLine
            })
          })

          if (lowestPriceShipping) {
            const { price } = lowestPriceShipping
            const discount = typeof response.free_shipping_from_value === 'number' &&
              response.free_shipping_from_value <= cartSubtotal
              ? price
              : 0
            if (discount) {
              lowestPriceShipping.total_price = price - discount
              lowestPriceShipping.discount = discount
            }
          }
          res.send(response)
        } else {
          // console.log(data)
          const err = new Error('Invalid Kangu calculate response')
          err.response = { data, status }
          throw err
        }
      })

      .catch(err => {
        let { message, response } = err
        if (response && response.data) {
          // try to handle kangu error response
          const { data } = response
          let result
          if (typeof data === 'string') {
            try {
              result = JSON.parse(data)
            } catch (e) {
            }
          } else {
            result = data
          }
          console.log('> kangu invalid result:', data)
          if (result && result.data) {
            // kangu error message
            return res.status(409).send({
              error: 'CALCULATE_FAILED',
              message: result.data
            })
          }
          message = `${message} (${response.status})`
        } else {
          console.error(err)
        }
        return res.status(409).send({
          error: 'CALCULATE_ERR',
          message
        })
      })
  } else {
    res.status(400).send({
      error: 'CALCULATE_EMPTY_CART',
      message: 'Cannot calculate shipping without cart items'
    })
  }

  res.send(response)
}
