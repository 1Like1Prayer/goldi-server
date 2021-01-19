import { Context } from 'koa';
import { Product, ProductModel } from '../db/models/product';
import { ProductInCart } from '../models/product-in-cart';
import { ServerError } from '../models/server-error';
import {
  joiCheckOutSchema,
  joiIdSchema,
  joiProductAddSchema,
  joiProductEditSchema,
} from '../validations/product-validation-schemas';

enum errorMessages {
  NOT_FOUND = 'product not found',
  NOT_VALID = 'product id not valid',
  INPUT_NOT_VALID = 'input was not valid',
  INTERNAL = 'internal server error',
}

export const getProducts = async (ctx: Context) => {
  try {
    ctx.body = await ProductModel.find();
  } catch (err) {
    throw new ServerError(err.message, 500, errorMessages.INTERNAL);
  }
};
export const getProductById = async (ctx: Context) => {
  const { error, value } = joiIdSchema.validate(ctx.params.id);
  if (error) {
    const joiError = {
      data: error.details.path,
      message: error.message,
    };
    throw new ServerError(error.message, 400, errorMessages.NOT_VALID, [joiError]);
  }
  try {
    const product = await ProductModel.findById(value);
    productExistenceCheck(product, ctx);
  } catch (err) {
    throw new ServerError(err.message, 400, errorMessages.NOT_VALID);
  }
};

export const addProduct = async (ctx: Context) => {
  const product = ctx.request.body;
  const { error, value } = joiProductAddSchema.validate(product, { abortEarly: false });
  if (error) {
    const joiError = error.details.map((detail) => ({
      data: detail.path,
      message: detail.message,
    }));
    throw new ServerError(error.message, 400, errorMessages.INPUT_NOT_VALID, joiError);
  }
  try {
    ctx.body = await new ProductModel(value).save();
    ctx.status = 201;
  } catch (err) {
    throw new ServerError(err.message, 500, errorMessages.INTERNAL);
  }
};

export const editProduct = async (ctx: Context) => {
  const productChanges = ctx.request.body;
  const { error: err, value: id } = joiIdSchema.validate(ctx.params.id);
  if (err) {
    const joiError = {
      data: err.details.path,
      message: err.message,
    };
    throw new ServerError(err.message, 400, errorMessages.INPUT_NOT_VALID, [joiError]);
  }
  const { error, value } = joiProductEditSchema.validate(productChanges, { abortEarly: false });
  if (error) {
    const joiError = error.details.map((detail) => ({
      data: detail.path,
      message: detail.message,
    }));
    throw new ServerError(error.message, 400, errorMessages.INPUT_NOT_VALID, joiError);
  }
  try {
    const product = await ProductModel.findByIdAndUpdate(id, value, {
      new: true,
    });
    productExistenceCheck(product, ctx);
  } catch (err) {
    throw new ServerError(err.message, 400, errorMessages.NOT_VALID);
  }
};

export const deleteProduct = async (ctx: Context) => {
  const { error, value } = joiIdSchema.validate(ctx.params.id);
  if (error) {
    const joiError = {
      data: error.details.path,
      message: error.message,
    };
    throw new ServerError(error.message, 400, errorMessages.INPUT_NOT_VALID, [joiError]);
  }
  try {
    const product = await ProductModel.findByIdAndRemove(value);
    productExistenceCheck(product, ctx);
  } catch (err) {
    throw new ServerError(err.message, 400, errorMessages.NOT_VALID);
  }
};

export const checkOut = async (ctx: Context) => {
  const products = ctx.request.body;
  const { error, value } = joiCheckOutSchema.validate(products, { abortEarly: false });
  if (error) {
    const joiError = error.details.map((detail) => ({
      data: detail.path,
      message: detail.message,
    }));
    throw new ServerError(error.message, 400, errorMessages.INPUT_NOT_VALID, joiError);
  }
  const session = await ProductModel.startSession();
  const productsAfterCheckout: Product[] = [];
  try {
    session.startTransaction();
    await Promise.all(
      value.map(async (cartProduct: ProductInCart) => {
        const product = await ProductModel.findOne({ name: cartProduct.name }).session(session);
        if (product && cartProduct.amount <= product.amount) {
          const updatedProduct = await ProductModel.findOneAndUpdate(
            { name: cartProduct.name },
            { amount: product.amount - cartProduct.amount },
            { new: true, session },
          );
          productsAfterCheckout.push(updatedProduct);
        } else {
          throw new Error('checkout amount exceeding the product current available amount');
        }
      }),
    );
    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw new ServerError(err.message, 500, errorMessages.INTERNAL);
  }
  ctx.body = productsAfterCheckout;
};

const productExistenceCheck = (product: Product, ctx: Context) => {
  if (!product) {
    ctx.body = errorMessages.NOT_FOUND;
    ctx.status = 404;
  } else {
    ctx.body = product;
  }
};
