const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')
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

  const { api_key, api_secret, is_sandbox } = appData
  if (!api_key && !api_secret) {
    // must have configured kangu doc number and token
    return res.status(409).send({
      error: 'CALCULATE_AUTH_ERR',
      message: 'Credentials are unset on app hidden data (merchant must configure the app)'
    })
  }
  const accessToken = await getToken(api_key, api_secret, is_sandbox, storeId)
  console.log('Receba access', accessToken)

  if (appData.free_shipping_from_value >= 0) {
    response.free_shipping_from_value = appData.free_shipping_from_value
  }

  const getBusinessDatesCount = (endDate) => {
    const startDate = new Date()
      let count = 0;
      const curDate = new Date(startDate.getTime());
      while (curDate <= endDate) {
          const dayOfWeek = curDate.getDay();
          if(dayOfWeek !== 0 && dayOfWeek !== 6) count++;
          curDate.setDate(curDate.getDate() + 1);
      }
      return count;
  }

  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
  const originZip = params.from
    ? params.from.zip.replace(/\D/g, '')
    : appData.zip ? appData.zip.replace(/\D/g, '') : ''
  
  const { currency, country_code, taxes, rate_sort_order, pickup_type, account_number } = appData

  const pickup = parsePickupType(pickup_type)
  const sort = parseShippingSort(rate_sort_order)

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
      const customsValue = {}
      const weightObject = {}
      customsValue.amount = item.final_price || item.price
      customsValue.currency = item.currency_id
      weightObject.units = 'KG'
      weightObject.value = physicalWeight


      commodities.push({
        weight: weightObject,
        customsValue,
        quantity,
        name
      })
    })

    const requestedShipment = {}
    const accountNumber = {}
    const rateRequestControlParameters = {}
    // rate params
    rateRequestControlParameters.returnTransitTimes = true
    rateRequestControlParameters.servicesNeededOnRateFailure = true
    rateRequestControlParameters.rateSortOrder = sort
    // account number
    accountNumber.value = account_number
    // requested shipment information
    // shipper
    requestedShipment.shipper = {
      address: {
        postalCode: originZip,
        countryCode: country_code
      }
    }
    // recipient
    requestedShipment.recipient = {
      address: {
        postalCode: destinationZip,
        countryCode: appData.country_code_to
      }
    }
    // currency
    requestedShipment.preferredCurrency = currency
    // type rate
    requestedShipment.rateRequestType = ["LIST","PREFERRED","ACCOUNT"]
    // pickup
    requestedShipment.pickupType = pickup
    // taxes
    requestedShipment.edtRequestType = taxes ? 'ALL' : 'NONE'
    // total package
    requestedShipment.requestedPackageLineItems = [{
      weight: {
        units: 'KG',
        value: finalWeight
      }
    }]
    requestedShipment.totalWeight = finalWeight
    requestedShipment.customsClearanceDetail = {}
    requestedShipment.customsClearanceDetail.commodities = commodities

    const body = {
      accountNumber,
      rateRequestControlParameters,
      requestedShipment
    }
    console.log('Body da requisicao', JSON.stringify(body))
    // send POST request to kangu REST API
    const url = `https://apis${is_sandbox ? '-sandbox.' : '.'}fedex.com/rate/v1/rates/quotes`
    return axios.post(
      url,
      body,
      {
        headers: {
          'Authorization': `bearer ${accessToken}`,
          accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: (params.is_checkout_confirmation ? 8000 : 4500)
      }
    )

      .then(({ data, status }) => {
        console.log('Resultado da requisicao', data)
        let result
        if (typeof data === 'string') {
          try {
            result = JSON.parse(data)
          } catch (e) {
            console.log('> Fedex invalid JSON response')
            return res.status(409).send({
              error: 'CALCULATE_INVALID_RES',
              message: data
            })
          }
        } else {
          result = data
        }

        if (result && Number(status) === 200 && Array.isArray(result && result.output && result.output.rateReplyDetails)) {
          // success response
          const rules = result && result.output && result.output.rateReplyDetails
          const quoteDate = result.output && result.output.quoteDate
          const delivery_time = getBusinessDatesCount(quoteDate)
          rules.forEach(fedexService => {
            // parse to E-Com Plus shipping line object
            const serviceCode = String(fedexService.serviceType)
            const price = fedexService[0].totalNetChargeWithDutiesAndTaxes

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
                days: parseInt(delivery_time, 10),
                working_days: true
              },
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
              flags: ['fedex-ws', `fedex-${serviceCode}`.substr(0, 20)]
            }

            response.shipping_services.push({
              label: fedexService.serviceName,
              carrier: fedexService.serviceName,
              service_name: `${(serviceCode)} (Kangu)`,
              service_code: serviceCode,
              shipping_line: shippingLine
            })
          })

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
          console.log('> Fedex invalid result:', data)
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
