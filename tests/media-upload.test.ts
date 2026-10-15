import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmMediaUploadCompliance } from '@/utils/mediaCompliance'
import { chooseCroppedAvatar } from '@/utils/avatar'
import { compressMediaImage, isMediaCancel, mediaErrorMessage, uploadMediaBatch } from '@/utils/mediaUpload'

const api = vi.hoisted(() => ({
  showModal: vi.fn(), chooseMedia: vi.fn(), cropImage: vi.fn(), compressImage: vi.fn(), saveFile: vi.fn()
}))
vi.mock('@tarojs/taro', () => ({ default: api }))

beforeEach(() => {
  vi.resetAllMocks()
  api.chooseMedia.mockResolvedValue({ tempFiles: [{ tempFilePath: 'source.jpg' }] })
  api.cropImage.mockResolvedValue({ tempFilePath: 'cropped.jpg' })
  api.compressImage.mockResolvedValue({ tempFilePath: 'compressed.jpg' })
  api.saveFile.mockResolvedValue({ savedFilePath: 'saved.jpg' })
})

describe('图片选择与提交', () => {
  it('保留上传须知，按钮符合四字符限制，取消时返回false', async () => {
    api.showModal.mockImplementation(async (options) => {
      expect(options.title).toBe('上传须知')
      expect([...options.confirmText].length).toBeLessThanOrEqual(4)
      return { confirm: true }
    })
    await expect(confirmMediaUploadCompliance()).resolves.toBe(true)
    api.showModal.mockResolvedValue({ confirm: false })
    await expect(confirmMediaUploadCompliance()).resolves.toBe(false)
  })

  it('头像完成选图、裁剪、压缩及文件保存', async () => {
    await expect(chooseCroppedAvatar()).resolves.toBe('saved.jpg')
    expect(api.showModal).not.toHaveBeenCalled()
    expect(api.cropImage).toHaveBeenCalledWith({ src: 'source.jpg', cropScale: '1:1' })
    expect(api.compressImage).toHaveBeenCalledWith({ src: 'cropped.jpg', quality: 82 })
  })

  it.each(['chooseMedia', 'cropImage'] as const)('微信对象形式的%s取消不会继续处理照片', async (method) => {
    api[method].mockRejectedValue({ errMsg: `${method}:fail cancel` })
    await expect(chooseCroppedAvatar()).resolves.toBeNull()
    expect(api.compressImage).not.toHaveBeenCalled()
    expect(api.saveFile).not.toHaveBeenCalled()
  })

  it('不支持裁剪、压缩、保存时使用选中的原图', async () => {
    api.cropImage.mockRejectedValue({ errMsg: 'cropImage:fail not supported' })
    api.compressImage.mockRejectedValue({ errMsg: 'compressImage:fail not supported' })
    api.saveFile.mockRejectedValue({ errMsg: 'saveFile:fail quota exceeded' })
    await expect(chooseCroppedAvatar()).resolves.toBe('source.jpg')
  })

  it('真实选图错误不会被吞掉或当作取消', async () => {
    const error = { errMsg: 'chooseMedia:fail auth deny' }
    api.chooseMedia.mockRejectedValue(error)
    await expect(chooseCroppedAvatar()).rejects.toEqual(error)
    expect(isMediaCancel(error)).toBe(false)
    expect(mediaErrorMessage(error)).toContain('未获授权')
    expect(mediaErrorMessage({ errMsg: 'chooseMedia:fail api scope is not declared in the privacy agreement' })).toBe('选图失败，请稍后重试')
    expect(mediaErrorMessage({ errMsg: 'uploadFile:fail network error' })).toContain('网络')
  })

  it('压缩失败或无输出路径时保留原图', async () => {
    api.compressImage.mockRejectedValueOnce({ errMsg: 'compressImage:fail' }).mockResolvedValueOnce({})
    await expect(compressMediaImage('original.jpg')).resolves.toBe('original.jpg')
    await expect(compressMediaImage('original.jpg')).resolves.toBe('original.jpg')
  })

  it('批量中间一张失败后继续提交，准确累计成功并指出失败序号', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    api.compressImage.mockImplementation(async ({ src }) => ({ tempFilePath: src }))
    const submit = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ errMsg: 'network error' }).mockResolvedValueOnce({})
    const onSaved = vi.fn()
    const result = await uploadMediaBatch(['a.jpg', 'b.jpg', 'c.jpg'], submit, onSaved)
    expect(result.saved).toBe(2)
    expect(result.failures).toEqual([{ index: 2, message: '网络连接异常，请检查网络后重试' }])
    expect(onSaved).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls.map(([file]) => file)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    log.mockRestore()
  })
})

it('所有源码弹窗的静态按钮文字均符合四字符上限', () => {
  const failures: string[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(filename); continue }
      if (!/\.tsx?$/.test(filename)) continue
      const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && ['confirmText', 'cancelText'].includes(node.name.getText(source)) && ts.isStringLiteralLike(node.initializer)) {
          if ([...node.initializer.text].length > 4) failures.push(`${filename}: ${node.initializer.text}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  walk('src')
  expect(failures).toEqual([])
})
