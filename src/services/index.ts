import { localStore } from './localStore'
import { cloudbaseEnabled } from './cloudService'
import { createCloudStore } from './cloudStore'

export const appService = cloudbaseEnabled ? createCloudStore(localStore) : localStore
