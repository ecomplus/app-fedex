const parseShippingSort = (rateSortOrder) => {
  switch (rateSortOrder) {
    case 'Maior para o menor preço do frete':
      return 'SERVICENAMETRADITIONAL'
    case 'Crescente prazo de entrega':
      return 'COMMITASCENDING'
    case 'Decrescente prazo de entrega':
      return 'COMMITDESCENDING'
  }
  return rateSortOrder
}

const parsePickupType = (pickupType) => {
  switch (pickupType) {
    case 'Agendar com a fedex':
      return 'CONTACT_FEDEX_TO_SCHEDULE'
    case 'Deixar na agencia fedex':
      return 'DROPOFF_AT_FEDEX_LOCATION'
    case 'Retirada Agendada':
      return 'USE_SCHEDULED_PICKUP'
  }
  return pickupType
}

module.exports = {
  parseShippingSort,
  parsePickupType
}
